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
		displayName: 'Librus Trigger',
		name: 'librusTrigger',
		subtitle: 'New Message',
		icon: 'file:librus.png',
		group: ['trigger'],
		version: 1,
		description: 'Start a workflow when a new Librus inbox message is detected',
		defaults: { name: 'Librus Trigger' },
		polling: true,
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'librusSessionApi', required: true, testedBy: 'librusConnectionTest' }],
		properties: [
			{
				displayName:
					'The first automatic poll saves the current inbox without emitting old messages. Manual tests return one sample without changing this history. Set Poll Times to every 5 minutes or longer.',
				name: 'baselineNotice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Event',
				name: 'event',
				type: 'options',
				noDataExpression: true,
				options: [{ name: 'New Message', value: 'newMessage' }],
				default: 'newMessage',
			},
			{
				displayName: 'Maximum Pages',
				name: 'maxPages',
				type: 'number',
				default: 20,
				typeOptions: { minValue: 1, maxValue: 50 },
				description:
					'Safety bound for scanning the entire inbox. Incomplete scans fail without advancing message history.',
			},
			{
				displayName: 'Include Preview',
				name: 'includePreview',
				type: 'boolean',
				default: true,
				description:
					'Whether to include the shortened inbox preview. Use Librus → Get Content with the message ID for the full body; that may mark it as read.',
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
