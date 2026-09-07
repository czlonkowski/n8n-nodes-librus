import type { IHttpRequestOptions } from 'n8n-workflow';
import type { Transport, Response } from './LibrusClient';

export function createTransport(
	httpRequest: (options: IHttpRequestOptions) => Promise<unknown>,
): Transport {
	return async (request) => {
		const response = await httpRequest({
			...request,
			disableFollowRedirect: true,
			returnFullResponse: true,
			ignoreHttpStatusErrors: true,
			json: false,
			encoding: 'text',
		});
		return response as Response;
	};
}

// n8n's custom credential-test context exposes only the legacy request helper.
export function createCredentialTestTransport(
	requestHelper: (options: object) => Promise<unknown>,
): Transport {
	return async (request) =>
		(await requestHelper({
			uri: request.url,
			method: request.method,
			headers: request.headers,
			body: request.body,
			timeout: request.timeout,
			followRedirect: false,
			followAllRedirects: false,
			resolveWithFullResponse: true,
			simple: false,
			json: false,
			encoding: 'utf8',
		})) as Response;
}
