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
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Read messages from Librus Synergia',
		defaults: { name: 'Librus' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'librusSessionApi', required: true, testedBy: 'librusConnectionTest' }],
		properties: [
			{
				displayName:
					'Experimental integration using unofficial Librus routes. Live account compatibility and unread-state behaviour still require verification.',
				name: 'experimentalNotice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [{ name: 'Message', value: 'message' }],
				default: 'message',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['message'] } },
				options: [
					{
						name: 'Get Content',
						value: 'getContent',
						description: 'Get the full body of a message by ID; may mark it as read',
						action: 'Get message content',
					},
					{
						name: 'Get Many',
						value: 'getAll',
						description: 'Get inbox messages',
						action: 'Get many messages',
					},
				],
				default: 'getAll',
			},
			{
				displayName: 'Message ID',
				name: 'messageId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { operation: ['getContent'] } },
				description: 'Message identifier from Get Many or Librus Trigger',
			},
			{
				displayName: 'Fetching the full message may mark it as read in Librus.',
				name: 'getContentNotice',
				type: 'notice',
				default: '',
				displayOptions: { show: { operation: ['getContent'] } },
			},
			{
				displayName: 'Read Status',
				name: 'readStatus',
				type: 'options',
				default: 'all',
				displayOptions: { show: { operation: ['getAll'] } },
				options: [
					{ name: 'All', value: 'all' },
					{ name: 'Unread', value: 'unread' },
					{ name: 'Read', value: 'read' },
				],
				description: 'Filter the inbox before applying Limit or fetching full content',
			},
			{
				displayName: 'Return All',
				name: 'returnAll',
				displayOptions: { show: { operation: ['getAll'] } },
				type: 'boolean',
				default: false,
				description: 'Whether to return all results or only up to a given limit',
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				default: 50,
				typeOptions: { minValue: 1, maxValue: 1000 },
				displayOptions: { show: { operation: ['getAll'], returnAll: [false] } },
				description: 'Max number of results to return',
			},
			{
				displayName: 'Maximum Pages',
				name: 'maxPages',
				displayOptions: { show: { operation: ['getAll'] } },
				type: 'number',
				default: 20,
				typeOptions: { minValue: 1, maxValue: 50 },
				description:
					'Safety bound on pagination. An incomplete scan fails without emitting partial results.',
			},
			{
				displayName: 'Include Content',
				name: 'includeContent',
				displayOptions: { show: { operation: ['getAll'] } },
				type: 'boolean',
				default: false,
				description:
					'Whether to include the message preview or fetch the full message body. Full messages may be marked as read by Librus.',
			},
			{
				displayName: 'Content Source',
				name: 'contentSource',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { operation: ['getAll'], includeContent: [true] } },
				options: [
					{
						name: 'Preview',
						value: 'preview',
						description: 'Read the shortened content from the inbox listing',
					},
					{
						name: 'Full Message',
						value: 'full',
						description: 'Fetch the full body for each message; this may mark it as read',
					},
				],
				default: 'preview',
				description:
					'Where to retrieve message content. Full Message makes an additional request for each message.',
			},
			{
				displayName:
					'Fetching full messages may mark them as read in Librus. Up to 50 full messages can be fetched per execution.',
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
						message: 'Successfully authenticated and read the inbox listing.',
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
