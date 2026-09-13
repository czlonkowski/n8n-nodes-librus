import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import type {
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IPollFunctions,
} from 'n8n-workflow';
import { LibrusClient, LibrusError, safeError } from './LibrusClient';
import { Librus } from './Librus.node';
import { createTransport } from './transport';
import { accountKey, selectNewMessages } from './pollState';
import {
	commitCalendarPoll,
	entrySnapshot,
	monthWindow,
	planCalendarPoll,
	type CalendarChange,
	type CalendarPlan,
} from './calendarState';

function parseTypes(value: string): string[] {
	return (typeof value === 'string' ? value : '')
		.split(',')
		.map((type) => type.trim().toLocaleLowerCase('pl'))
		.filter((type) => type);
}
/** An unknown kind always passes: a missed cancellation is worse than one extra item. */
function matchesType(types: string[], rodzaj: string | null): boolean {
	if (!types.length || !rodzaj) return true;
	return types.includes(rodzaj.trim().toLocaleLowerCase('pl'));
}

async function pollCalendar(
	context: IPollFunctions,
	client: LibrusClient,
	manual: boolean,
	account: string,
	event: 'newCalendarEvent' | 'changedCalendarEvent',
): Promise<INodeExecutionData[][] | null> {
	const types = parseTypes(context.getNodeParameter('eventTypes') as string);
	if (manual) {
		// The sample deliberately ignores `types`: the Rodzaj vocabulary is unverified, so
		// the manual test is how a user reads the real values, and a narrow filter would
		// return an empty sample that looks like a broken connection. Do not "fix" this.
		const window = monthWindow(new Date(), 0);
		const scan = await client.getCalendar({ months: window.months }, (entries) =>
			entries.slice(0, 5).map((entry) => entry.key),
		);
		const items = scan.entries.slice(0, 5).map((entry) => {
			const detail = scan.details.get(entry.key) ?? null;
			return {
				json: {
					changeType: 'sample',
					eventKey: entry.key,
					eventId: entry.eventId,
					route: entry.route,
					...entrySnapshot(entry, detail),
					changedFields: [],
					previous: null,
					details: detail?.fields ?? null,
				},
			};
		});
		return items.length ? [items] : null;
	}
	const window = monthWindow(new Date(), context.getNodeParameter('monthsAhead') as number);
	const state = context.getWorkflowStaticData('node');
	let plan: CalendarPlan | undefined;
	const scan = await client.getCalendar({ months: window.months }, (entries) => {
		plan = planCalendarPoll(state, account, window, entries);
		return plan.hydrate;
	});
	if (plan === undefined) throw new LibrusError('PROTOCOL_ERROR');
	const { aborted, changes } = commitCalendarPoll(state, account, plan, scan.details);
	if (aborted) return null;
	const wanted: CalendarChange['changeType'][] =
		event === 'newCalendarEvent' ? ['new'] : ['changed', 'removed'];
	const items = changes
		.filter(
			(change) => wanted.includes(change.changeType) && matchesType(types, change.event.rodzaj),
		)
		.map((change) => ({
			json: {
				changeType: change.changeType,
				eventKey: change.key,
				eventId: change.eventId,
				route: change.route,
				...change.event,
				changedFields: change.changedFields,
				previous: change.previous,
				details: scan.details.get(change.key)?.fields ?? null,
			},
		}));
	return items.length ? [items] : null;
}

export class LibrusTrigger implements INodeType {
	description: INodeTypeDescription = {
		// n8n uses the Trigger suffix to discover events on the shared Librus card.
		displayName: 'Librus Trigger',
		name: 'librusTrigger',
		// The fallback matches the `event` parameter's default, so an unexpected value
		// never labels the node with a calendar event it is not running.
		subtitle:
			'={{$parameter["event"] === "newCalendarEvent" ? "Nowe wydarzenie w terminarzu" : $parameter["event"] === "changedCalendarEvent" ? "Zmiana wydarzenia w terminarzu" : "Nowa wiadomość"}}',
		icon: 'file:librus.png',
		group: ['trigger'],
		version: 1,
		description:
			'Uruchamiaj workflow po otrzymaniu nowej wiadomości albo po dodaniu lub zmianie wydarzenia w terminarzu Librus Synergia',
		defaults: { name: 'Librus — wyzwalacz' },
		polling: true,
		eventTriggerDescription: 'Po wykryciu nowej wiadomości lub zmiany w terminarzu Librus Synergia',
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'librusSessionApi', required: true, testedBy: 'librusConnectionTest' }],
		properties: [
			{
				displayName: 'Zdarzenie',
				name: 'event',
				type: 'options',
				noDataExpression: true,
				default: 'newMessage',
				options: [
					{
						name: 'Nowa wiadomość',
						value: 'newMessage',
						action: 'Nowa wiadomość',
						description: 'Uruchom po otrzymaniu nowej wiadomości w skrzynce',
					},
					{
						name: 'Nowe wydarzenie w terminarzu',
						value: 'newCalendarEvent',
						action: 'Nowe wydarzenie w terminarzu',
						description: 'Uruchom po dodaniu wydarzenia do terminarza',
					},
					{
						name: 'Zmiana wydarzenia w terminarzu',
						value: 'changedCalendarEvent',
						action: 'Zmiana wydarzenia w terminarzu',
						description: 'Uruchom po zmianie, przeniesieniu lub zniknięciu wydarzenia z terminarza',
					},
				],
			},
			{
				displayName:
					'Pierwsze automatyczne sprawdzenie zapamiętuje obecną skrzynkę bez uruchamiania workflow dla starych wiadomości. Test ręczny zwraca jedną próbkę i nie zmienia historii. Ustaw harmonogram (Poll Times) na co najmniej 5 minut.',
				name: 'baselineNotice',
				type: 'notice',
				default: '',
				displayOptions: { show: { event: ['newMessage'] } },
			},
			{
				displayName: 'Maksymalna liczba stron',
				name: 'maxPages',
				type: 'number',
				default: 20,
				typeOptions: { minValue: 1, maxValue: 50 },
				displayOptions: { show: { event: ['newMessage'] } },
				description:
					'Limit stron podczas sprawdzania całej skrzynki. Niepełny skan kończy się błędem i nie zmienia historii wykrytych wiadomości.',
			},
			{
				displayName: 'Dołącz podgląd',
				name: 'includePreview',
				type: 'boolean',
				default: true,
				displayOptions: { show: { event: ['newMessage'] } },
				description:
					'Dołącz skrócony podgląd wiadomości. Pełną treść pobierzesz przez Librus → Pobierz treść wiadomości, podając jej ID. Może to oznaczyć wiadomość jako przeczytaną.',
			},
			{
				displayName:
					'Pierwsze automatyczne sprawdzenie zapamiętuje obecny terminarz bez uruchamiania workflow dla istniejących wydarzeń. Test ręczny zwraca do pięciu wydarzeń z bieżącego miesiąca i nie zmienia historii; celowo pomija filtr Rodzaje wydarzeń, żeby dało się odczytać z wyniku prawdziwe wartości pola rodzaj. Ustaw harmonogram (Poll Times) na co najmniej 15 minut.',
				name: 'calendarBaselineNotice',
				type: 'notice',
				default: '',
				displayOptions: { show: { event: ['newCalendarEvent', 'changedCalendarEvent'] } },
			},
			{
				displayName: 'Liczba miesięcy do przodu',
				name: 'monthsAhead',
				type: 'number',
				default: 1,
				typeOptions: { minValue: 0, maxValue: 6 },
				displayOptions: { show: { event: ['newCalendarEvent', 'changedCalendarEvent'] } },
				description:
					'Ile miesięcy po bieżącym sprawdzać. Każdy miesiąc to jedno dodatkowe zapytanie, a wydarzeń spoza tego zakresu nie wykryjemy.',
			},
			{
				displayName: 'Rodzaje wydarzeń',
				name: 'eventTypes',
				type: 'string',
				default: '',
				placeholder: 'Sprawdzian, Kartkówka',
				displayOptions: { show: { event: ['newCalendarEvent', 'changedCalendarEvent'] } },
				description:
					'Lista rodzajów po przecinku, dopasowywana bez rozróżniania wielkości liter. Puste pole przepuszcza wszystkie wydarzenia. Wydarzenia o nieznanym rodzaju są zawsze przepuszczane, żeby nie zgubić odwołanego wydarzenia.',
			},
		],
	};

	methods = new Librus().methods;

	async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
		try {
			const event = this.getNodeParameter('event');
			const credentials = await this.getCredentials('librusSessionApi');
			if (typeof credentials.username !== 'string' || typeof credentials.password !== 'string')
				throw new LibrusError('INVALID_OPTIONS');
			const client = new LibrusClient(
				createTransport(this.helpers.httpRequest.bind(this.helpers)),
				{
					username: credentials.username,
					password: credentials.password,
				},
			);
			const manual = this.getMode() === 'manual';
			const account = accountKey(
				credentials.username,
				this.getNode().credentials?.librusSessionApi?.id ?? '',
			);
			if (event === 'newCalendarEvent' || event === 'changedCalendarEvent')
				return await pollCalendar(this, client, manual, account, event);
			if (event !== 'newMessage') throw new LibrusError('INVALID_OPTIONS');
			const messages = await client.getMessages({
				returnAll: !manual,
				limit: 1,
				maxPages: this.getNodeParameter('maxPages') as number,
				includeContent: this.getNodeParameter('includePreview') as boolean,
				contentSource: 'preview',
			});
			const result = manual
				? messages
				: selectNewMessages(this.getWorkflowStaticData('node'), account, messages);
			return result.length ? [result.map((message) => ({ json: { ...message } }))] : null;
		} catch (error) {
			const safe = safeError(error);
			throw new NodeOperationError(this.getNode(), `${safe.code}: ${safe.message}`);
		}
	}
}
