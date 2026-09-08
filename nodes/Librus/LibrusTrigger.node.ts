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

export class LibrusTrigger implements INodeType {
	description: INodeTypeDescription = {
		// n8n uses the Trigger suffix to discover events on the shared Librus card.
		displayName: 'Librus Trigger',
		name: 'librusTrigger',
		subtitle: 'Nowa wiadomość',
		icon: 'file:librus.png',
		group: ['trigger'],
		version: 1,
		description:
			'Pobieraj wiadomości i ich pełną treść z Librus Synergia oraz uruchamiaj workflow po otrzymaniu nowych wiadomości',
		defaults: { name: 'Librus — Nowa wiadomość' },
		polling: true,
		eventTriggerDescription: 'Po wykryciu nowej wiadomości w Librus Synergia',
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'librusSessionApi', required: true, testedBy: 'librusConnectionTest' }],
		properties: [
			{
				displayName:
					'Pierwsze automatyczne sprawdzenie zapamiętuje obecną skrzynkę bez uruchamiania workflow dla starych wiadomości. Test ręczny zwraca jedną próbkę i nie zmienia historii. Ustaw harmonogram (Poll Times) na co najmniej 5 minut.',
				name: 'baselineNotice',
				type: 'notice',
				default: '',
			},
			{
				// n8n discovers events by this English label. Hide the sole fixed choice.
				displayName: 'Event',
				name: 'event',
				type: 'hidden',
				noDataExpression: true,
				options: [{ name: 'Nowa wiadomość', value: 'newMessage', action: 'Nowa wiadomość' }],
				default: 'newMessage',
			},
			{
				displayName: 'Maksymalna liczba stron',
				name: 'maxPages',
				type: 'number',
				default: 20,
				typeOptions: { minValue: 1, maxValue: 50 },
				description:
					'Limit stron podczas sprawdzania całej skrzynki. Niepełny skan kończy się błędem i nie zmienia historii wykrytych wiadomości.',
			},
			{
				displayName: 'Dołącz podgląd',
				name: 'includePreview',
				type: 'boolean',
				default: true,
				description:
					'Dołącz skrócony podgląd wiadomości. Pełną treść pobierzesz przez Librus → Pobierz treść wiadomości, podając jej ID. Może to oznaczyć wiadomość jako przeczytaną.',
			},
		],
	};

	methods = new Librus().methods;

	async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
		try {
			if (this.getNodeParameter('event') !== 'newMessage') throw new LibrusError('INVALID_OPTIONS');
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
			const messages = await client.getMessages({
				returnAll: !manual,
				limit: 1,
				maxPages: this.getNodeParameter('maxPages') as number,
				includeContent: this.getNodeParameter('includePreview') as boolean,
				contentSource: 'preview',
			});
			const result = manual
				? messages
				: selectNewMessages(
						this.getWorkflowStaticData('node'),
						accountKey(
							credentials.username,
							this.getNode().credentials?.librusSessionApi?.id ?? '',
						),
						messages,
					);
			return result.length ? [result.map((message) => ({ json: { ...message } }))] : null;
		} catch (error) {
			const safe = safeError(error);
			throw new NodeOperationError(this.getNode(), `${safe.code}: ${safe.message}`);
		}
	}
}
