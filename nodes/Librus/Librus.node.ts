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

export class Librus implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Librus',
		name: 'librus',
		icon: 'file:librus.png',
		group: ['input'],
		version: 1,
		subtitle:
			'={{$parameter["operation"] === "getContent" ? "Pobierz treść wiadomości" : "Pobierz wiadomości"}}',
		description:
			'Pobieraj wiadomości i ich pełną treść z Librus Synergia oraz uruchamiaj workflow po otrzymaniu nowych wiadomości',
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
				options: [{ name: 'Wiadomość', value: 'message' }],
				default: 'message',
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
					const client = new LibrusClient(
						createCredentialTestTransport(this.helpers.request.bind(this.helpers)),
						{ username: data.username, password: data.password },
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
				if (
					this.getNodeParameter('resource', itemIndex) !== 'message' ||
					!['getAll', 'getContent'].includes(
						this.getNodeParameter('operation', itemIndex) as string,
					)
				)
					throw new LibrusError('INVALID_OPTIONS');
				const credentials = await this.getCredentials('librusSessionApi', itemIndex);
				if (typeof credentials.username !== 'string' || typeof credentials.password !== 'string')
					throw new LibrusError('INVALID_OPTIONS');
				const client = new LibrusClient(
					createTransport(this.helpers.httpRequest.bind(this.helpers)),
					{ username: credentials.username, password: credentials.password },
				);
				if (this.getNodeParameter('operation', itemIndex) === 'getContent') {
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
