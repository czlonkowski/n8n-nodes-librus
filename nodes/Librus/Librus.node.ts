import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import type {
	ICredentialTestFunctions,
	ICredentialsDecrypted,
	IExecuteFunctions,
	INodeCredentialTestResult,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import {
	LibrusClient,
	LibrusError,
	safeError,
	type ContentSource,
	type ReadStatus,
} from './LibrusClient';
import { createTransport, createCredentialTestTransport } from './transport';
import { sharedSessions } from './sessionCache';
import { parseProxy, proxyUrl } from './proxy';
import { entrySnapshot, monthWindow } from './calendarState';

/** Today's date in Poland, where Librus dates live. */
function todayInPoland(now = new Date()): string {
	return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw' }).format(now);
}

export class Librus implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Librus',
		name: 'librus',
		icon: 'file:librus.png',
		group: ['input'],
		version: 1,
		subtitle:
			'={{$parameter["resource"] === "calendar" ? "Pobierz wydarzenia z terminarza" : ($parameter["operation"] === "getContent" ? "Pobierz treść wiadomości" : "Pobierz wiadomości")}}',
		description:
			'Pobieraj wiadomości, ich pełną treść i wydarzenia z terminarza Librus Synergia oraz uruchamiaj workflow po otrzymaniu nowych wiadomości',
		defaults: { name: 'Librus' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'librusSessionApi', required: true, testedBy: 'librusConnectionTest' }],
		properties: [
			{
				displayName:
					'Nieoficjalna integracja z Librus Synergia. Pobranie pełnej treści może oznaczyć wiadomość jako przeczytaną.',
				name: 'experimentalNotice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Zasób',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Wiadomość', value: 'message' },
					{ name: 'Terminarz', value: 'calendar' },
				],
				default: 'message',
			},
			{
				displayName: 'Operacja',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['calendar'] } },
				options: [
					{
						name: 'Pobierz wydarzenia',
						value: 'getEvents',
						description: 'Pobierz wpisy z terminarza z bieżącego i kolejnych miesięcy',
						action: 'Pobierz wydarzenia z terminarza',
					},
				],
				default: 'getEvents',
			},
			{
				displayName: 'Liczba kolejnych miesięcy',
				name: 'monthsAhead',
				type: 'number',
				default: 2,
				typeOptions: { minValue: 0, maxValue: 6 },
				displayOptions: { show: { resource: ['calendar'], operation: ['getEvents'] } },
				description: 'Ile miesięcy po bieżącym sprawdzić. 0 oznacza tylko bieżący miesiąc.',
			},
			{
				displayName: 'Tylko nadchodzące',
				name: 'onlyUpcoming',
				type: 'boolean',
				default: true,
				displayOptions: { show: { resource: ['calendar'], operation: ['getEvents'] } },
				description: 'Pomiń wpisy z datą wcześniejszą niż dzisiejsza (czas polski)',
			},
			{
				displayName:
					'Szczegóły wpisu (rodzaj, sala, nauczyciel, opis) są pobierane dla maksymalnie 50 wpisów w jednym wykonaniu. Pozostałe mają tylko dane z siatki terminarza i pole details równe null.',
				name: 'calendarNotice',
				type: 'notice',
				default: '',
				displayOptions: { show: { resource: ['calendar'], operation: ['getEvents'] } },
			},
			{
				displayName: 'Operacja',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['message'] } },
				options: [
					{
						name: 'Pobierz treść wiadomości',
						value: 'getContent',
						description:
							'Pobierz pełną treść wiadomości na podstawie jej ID; może to oznaczyć ją jako przeczytaną',
						action: 'Pobierz treść wiadomości',
					},
					{
						name: 'Pobierz wiadomości',
						value: 'getAll',
						description: 'Pobierz wiadomości ze skrzynki odbiorczej',
						action: 'Pobierz wiadomości',
					},
				],
				default: 'getAll',
			},
			{
				displayName: 'ID wiadomości',
				name: 'messageId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { operation: ['getContent'] } },
				description:
					'Wartość messageId z operacji Pobierz wiadomości lub ze zdarzenia Nowa wiadomość',
			},
			{
				displayName: 'Pobranie pełnej treści może oznaczyć wiadomość jako przeczytaną w Librusie.',
				name: 'getContentNotice',
				type: 'notice',
				default: '',
				displayOptions: { show: { operation: ['getContent'] } },
			},
			{
				displayName: 'Status odczytania',
				name: 'readStatus',
				type: 'options',
				default: 'all',
				displayOptions: { show: { operation: ['getAll'] } },
				options: [
					{ name: 'Wszystkie', value: 'all' },
					{ name: 'Nieprzeczytane', value: 'unread' },
					{ name: 'Przeczytane', value: 'read' },
				],
				description: 'Filtruj wiadomości przed zastosowaniem limitu i pobraniem pełnej treści',
			},
			{
				displayName: 'Pobierz wszystkie',
				name: 'returnAll',
				displayOptions: { show: { operation: ['getAll'] } },
				type: 'boolean',
				default: false,
				description: 'Zwróć wszystkie pasujące wiadomości, w granicach maksymalnej liczby stron',
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				default: 50,
				typeOptions: { minValue: 1, maxValue: 1000 },
				displayOptions: { show: { operation: ['getAll'], returnAll: [false] } },
				description: 'Maksymalna liczba wiadomości do pobrania',
			},
			{
				displayName: 'Maksymalna liczba stron',
				name: 'maxPages',
				displayOptions: { show: { operation: ['getAll'] } },
				type: 'number',
				default: 20,
				typeOptions: { minValue: 1, maxValue: 50 },
				description:
					'Limit stron skrzynki do sprawdzenia. Niepełne pobranie kończy się błędem, bez zwracania częściowych wyników.',
			},
			{
				displayName: 'Dołącz treść',
				name: 'includeContent',
				displayOptions: { show: { operation: ['getAll'] } },
				type: 'boolean',
				default: false,
				description:
					'Dołącz podgląd lub pełną treść wiadomości. Pobranie pełnej treści może oznaczyć wiadomość jako przeczytaną w Librusie.',
			},
			{
				displayName: 'Zakres treści',
				name: 'contentSource',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { operation: ['getAll'], includeContent: [true] } },
				options: [
					{
						name: 'Podgląd',
						value: 'preview',
						description: 'Pobierz skrócony podgląd z listy wiadomości',
					},
					{
						name: 'Pełna treść',
						value: 'full',
						description:
							'Pobierz pełną treść każdej wiadomości; może to oznaczyć ją jako przeczytaną',
					},
				],
				default: 'preview',
				description:
					'Wybierz podgląd lub pełną treść. Pełna treść wymaga dodatkowego zapytania dla każdej wiadomości.',
			},
			{
				displayName:
					'Pobranie pełnej treści może oznaczyć wiadomości jako przeczytane w Librusie. W jednym wykonaniu można pobrać pełną treść maksymalnie 50 wiadomości.',
				name: 'fullContentNotice',
				type: 'notice',
				default: '',
				displayOptions: {
					show: { operation: ['getAll'], includeContent: [true], contentSource: ['full'] },
				},
			},
		],
	};

	methods = {
		credentialTest: {
			async librusConnectionTest(
				this: ICredentialTestFunctions,
				credential: ICredentialsDecrypted,
			): Promise<INodeCredentialTestResult> {
				try {
					const data = credential.data;
					if (typeof data?.username !== 'string' || typeof data?.password !== 'string')
						throw new LibrusError('INVALID_OPTIONS');
					const proxy = parseProxy(data.proxyUrl);
					const client = new LibrusClient(
						createCredentialTestTransport(this.helpers.request.bind(this.helpers), proxy),
						{ username: data.username, password: data.password },
						{ proxy: proxy && proxyUrl(proxy) },
					);
					await client.getMessages({
						returnAll: false,
						limit: 1,
						maxPages: 1,
						includeContent: false,
					});
					return {
						status: 'OK',
						message: 'Połączenie działa. Zalogowano do Librusa i odczytano listę wiadomości.',
					};
				} catch (error) {
					const safe = safeError(error);
					return { status: 'Error', message: `${safe.code}: ${safe.message}` };
				}
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const output: INodeExecutionData[] = [];
		for (let itemIndex = 0; itemIndex < this.getInputData().length; itemIndex++) {
			try {
				const resource = this.getNodeParameter('resource', itemIndex);
				const operation = this.getNodeParameter('operation', itemIndex) as string;
				if (
					!(resource === 'message' && ['getAll', 'getContent'].includes(operation)) &&
					!(resource === 'calendar' && operation === 'getEvents')
				)
					throw new LibrusError('INVALID_OPTIONS');
				const credentials = await this.getCredentials('librusSessionApi', itemIndex);
				if (typeof credentials.username !== 'string' || typeof credentials.password !== 'string')
					throw new LibrusError('INVALID_OPTIONS');
				const proxy = parseProxy(credentials.proxyUrl);
				const client = new LibrusClient(
					createTransport(this.helpers.httpRequest.bind(this.helpers), proxy),
					{ username: credentials.username, password: credentials.password },
					{
						sessions: sharedSessions,
						log: (message) => this.logger?.info(message),
						proxy: proxy && proxyUrl(proxy),
					},
				);
				if (resource === 'calendar') {
					const window = monthWindow(
						new Date(),
						this.getNodeParameter('monthsAhead', itemIndex) as number,
					);
					const onlyUpcoming = this.getNodeParameter('onlyUpcoming', itemIndex) as boolean;
					const today = todayInPoland();
					const wanted = (entry: { date: string }) => !onlyUpcoming || entry.date >= today;
					const scan = await client.getCalendar({ months: window.months }, (entries) =>
						entries.filter(wanted).map((entry) => entry.key),
					);
					for (const entry of scan.entries.filter(wanted)) {
						const detail = scan.details.get(entry.key) ?? null;
						output.push({
							json: {
								changeType: 'existing',
								eventKey: entry.key,
								eventId: entry.eventId,
								route: entry.route,
								...entrySnapshot(entry, detail),
								changedFields: [],
								previous: null,
								details: detail?.fields ?? null,
							},
							pairedItem: { item: itemIndex },
						});
					}
					continue;
				}
				if (operation === 'getContent') {
					const result = await client.getMessageContent(
						this.getNodeParameter('messageId', itemIndex) as string,
					);
					output.push({ json: { ...result }, pairedItem: { item: itemIndex } });
					continue;
				}
				const returnAll = this.getNodeParameter('returnAll', itemIndex) as boolean;
				const result = await client.getMessages({
					returnAll,
					readStatus: this.getNodeParameter('readStatus', itemIndex, 'all') as ReadStatus,
					limit: returnAll ? 50 : (this.getNodeParameter('limit', itemIndex) as number),
					maxPages: this.getNodeParameter('maxPages', itemIndex) as number,
					includeContent: this.getNodeParameter('includeContent', itemIndex) as boolean,
					contentSource: this.getNodeParameter(
						'contentSource',
						itemIndex,
						'preview',
					) as ContentSource,
				});
				output.push(
					...result.map((message) => ({ json: { ...message }, pairedItem: { item: itemIndex } })),
				);
			} catch (error) {
				const safe = safeError(error);
				if (this.continueOnFail()) {
					output.push({
						json: { error: safe.message, code: safe.code },
						pairedItem: { item: itemIndex },
					});
					continue;
				}
				throw new NodeOperationError(this.getNode(), `${safe.code}: ${safe.message}`, {
					itemIndex,
				});
			}
		}
		return [output];
	}
}
