import type { IHttpRequestOptions } from 'n8n-workflow';
import type { Transport, Response } from './LibrusClient';

// The legacy helper represents an empty HTTP body as undefined, including redirects.
// Keep only response fields; its extra request metadata may contain credentials.
function normalizeResponse(value: unknown): Response {
	const response = value as Response;
	return {
		statusCode: response.statusCode,
		headers: response.headers,
		body: response.body === undefined ? '' : response.body,
	};
}

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
		return normalizeResponse(response);
	};
}

// n8n's custom credential-test context exposes only the legacy request helper.
export function createCredentialTestTransport(
	requestHelper: (options: object) => Promise<unknown>,
): Transport {
	return async (request) =>
		normalizeResponse(
			await requestHelper({
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
			}),
		);
}
