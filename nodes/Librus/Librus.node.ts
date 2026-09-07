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
import { LibrusClient, LibrusError, safeError } from './LibrusClient';
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
						name: 'Get Many',
						value: 'getAll',
						description: 'Get inbox messages',
						action: 'Get many messages',
					},
				],
				default: 'getAll',
			},
			{
				displayName: 'Return All',
				name: 'returnAll',
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
				displayOptions: { show: { returnAll: [false] } },
				description: 'Max number of results to return',
			},
			{
				displayName: 'Maximum Pages',
				name: 'maxPages',
				type: 'number',
				default: 20,
				typeOptions: { minValue: 1, maxValue: 50 },
				description:
					'Safety bound on pagination. An incomplete scan fails without emitting partial results.',
			},
			{
				displayName: 'Include Content',
				name: 'includeContent',
				type: 'boolean',
				default: false,
				description:
					'Whether to decode content supplied by the inbox listing. This may contain HTML and personal information; completeness is unverified.',
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
					this.getNodeParameter('operation', itemIndex) !== 'getAll'
				)
					throw new LibrusError('INVALID_OPTIONS');
				const credentials = await this.getCredentials('librusSessionApi', itemIndex);
				if (typeof credentials.username !== 'string' || typeof credentials.password !== 'string')
					throw new LibrusError('INVALID_OPTIONS');
				const client = new LibrusClient(
					createTransport(this.helpers.httpRequest.bind(this.helpers)),
					{ username: credentials.username, password: credentials.password },
				);
				const returnAll = this.getNodeParameter('returnAll', itemIndex) as boolean;
				const result = await client.getMessages({
					returnAll,
					limit: returnAll ? 50 : (this.getNodeParameter('limit', itemIndex) as number),
					maxPages: this.getNodeParameter('maxPages', itemIndex) as number,
					includeContent: this.getNodeParameter('includeContent', itemIndex) as boolean,
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
