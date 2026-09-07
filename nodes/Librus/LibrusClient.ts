import { CookieJar } from 'tough-cookie';

export interface Request {
	url: string;
	method: 'GET' | 'POST';
	headers: Record<string, string>;
	body?: string;
	timeout: number;
}
export interface Response {
	statusCode: number;
	headers: Record<string, string | string[] | undefined>;
	body: string;
}
export type Transport = (request: Request) => Promise<Response>;
export interface Login {
	username: string;
	password: string;
}
export type ContentSource = 'preview' | 'full';
export type ReadStatus = 'all' | 'unread' | 'read';
export interface Scan {
	returnAll: boolean;
	limit: number;
	maxPages: number;
	includeContent: boolean;
	contentSource?: ContentSource;
	readStatus?: ReadStatus;
}
export interface Message {
	messageId: string;
	senderFirstName: string;
	senderLastName: string;
	senderName: string;
	topic: string;
	sendDate: string;
	readDate: string | null;
	isAnyFileAttached: boolean;
	tags: string[];
	category: string | null;
	content?: string;
	contentSource?: ContentSource;
}

const messages: Record<string, string> = {
	UNSAFE_URL: 'Librus returned an unexpected destination. No request was sent to it.',
	TRANSPORT_ERROR: 'The Librus request failed. Check connectivity and try again later.',
	PROTOCOL_ERROR: 'Librus returned an unexpected response. The integration may need updating.',
	AUTH_FAILED: 'Librus login was not accepted. Check your credentials in the Librus website.',
	ACTION_REQUIRED: 'Complete any login verification or account prompts in the Librus website.',
	SESSION_EXPIRED: 'The Librus session expired during the request.',
	RATE_LIMITED: 'Librus is limiting requests. Wait before trying again.',
	ACCESS_DENIED: 'Librus denied this request. Check account access in the website.',
	SERVICE_ERROR: 'Librus is unavailable or returned an unexpected HTTP status.',
	SCAN_INCOMPLETE:
		'The inbox scan could not finish within its safety limits. Increase Maximum Pages or use a bounded Limit.',
	FULL_CONTENT_LIMIT:
		'Full message content is limited to 50 messages per execution. Turn off Return All and set Limit to 50 or less.',
	INVALID_OPTIONS: 'Invalid Librus credentials or scan options.',
	TRIGGER_STATE_INVALID:
		'The saved Librus trigger state is invalid. Recreate the trigger to establish a new inbox baseline.',
	TRIGGER_STATE_LIMIT:
		'The Librus trigger has reached its 10000-message history limit. Recreate the trigger to establish a new inbox baseline.',
};
type AuthStage =
	| 'login entry'
	| 'credential submission'
	| 'authorization continuation'
	| 'messages initialization';
type AuthDestination =
	| 'OAuth authorization'
	| 'Synergia OAuth callback'
	| 'Synergia login'
	| 'Synergia page'
	| 'messages service'
	| 'other allowed page';

export class LibrusError extends Error {
	constructor(
		public readonly code: string,
		stage?: AuthStage,
		destination?: AuthDestination,
		rejection?:
			| 'non-HTTPS destination'
			| 'URL credentials'
			| 'non-default port'
			| 'unrecognized hostname',
	) {
		super(
			(messages[code] ?? messages.PROTOCOL_ERROR) +
				(stage ? ` [Step: ${stage}; page: ${destination}]` : '') +
				(rejection ? ` [Redirect rejected: ${rejection}]` : ''),
		);
	}
}
export function safeError(error: unknown): LibrusError {
	return error instanceof LibrusError ? error : new LibrusError('PROTOCOL_ERROR');
}
const allowedHosts = new Set([
	'portal.librus.pl',
	'synergia.librus.pl',
	'api.librus.pl',
	'wiadomosci.librus.pl',
]);
function checkedUrl(value: string, base?: string): URL {
	let url: URL;
	try {
		url = new URL(value, base);
	} catch {
		throw new LibrusError('UNSAFE_URL');
	}
	if (
		url.protocol !== 'https:' ||
		url.port ||
		url.username ||
		url.password ||
		!allowedHosts.has(url.hostname)
	) {
		const rejection =
			url.protocol !== 'https:'
				? 'non-HTTPS destination'
				: url.username || url.password
					? 'URL credentials'
					: url.port
						? 'non-default port'
						: 'unrecognized hostname';
		throw new LibrusError('UNSAFE_URL', undefined, undefined, rejection);
	}
	return url;
}
function checkedRedirect(value: string, base: string): URL {
	let url: URL;
	try {
		url = new URL(value, base);
	} catch {
		throw new LibrusError('UNSAFE_URL');
	}
	// Legacy Location headers can use HTTP. Only upgrade exact trusted hosts;
	// requests themselves always use HTTPS, including the first redirected hop.
	if (
		url.protocol === 'http:' &&
		allowedHosts.has(url.hostname) &&
		!url.port &&
		!url.username &&
		!url.password
	)
		url.protocol = 'https:';
	return checkedUrl(url.href);
}
function authUrl(url: URL): boolean {
	return url.hostname === 'api.librus.pl' && /^\/OAuth\/Authorization(?:\/|$)/.test(url.pathname);
}
function actionRequired(stage: AuthStage, url: URL): LibrusError {
	const destination: AuthDestination = authUrl(url)
		? 'OAuth authorization'
		: url.hostname === 'synergia.librus.pl' && url.pathname === '/loguj/portalRodzina'
			? 'Synergia OAuth callback'
			: url.hostname === 'synergia.librus.pl' && /^\/loguj(?:\/|$)/.test(url.pathname)
				? 'Synergia login'
				: url.hostname === 'synergia.librus.pl'
					? 'Synergia page'
					: url.hostname === 'wiadomosci.librus.pl'
						? 'messages service'
						: 'other allowed page';
	return new LibrusError('ACTION_REQUIRED', stage, destination);
}
function object(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function parseJson(body: string): unknown {
	try {
		return JSON.parse(body);
	} catch {
		throw new LibrusError('PROTOCOL_ERROR');
	}
}
function isHtml(body: string): boolean {
	return /^\s*<(?:!doctype\s+html|html\b|form\b)/i.test(body);
}
function isLoginForm(body: string): boolean {
	// Do not mistake JSON containing a message's HTML for a login page.
	return (
		isHtml(body) &&
		/<form\b/i.test(body) &&
		/<input\b[^>]*\bname\s*=\s*["'](?:pass|password)["']/i.test(body) &&
		/<input\b[^>]*\bname\s*=\s*["']login["']/i.test(body)
	);
}
function decodeContent(value: unknown): string {
	if (
		typeof value !== 'string' ||
		!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
	) {
		throw new LibrusError('PROTOCOL_ERROR');
	}
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(value, 'base64'));
	} catch {
		throw new LibrusError('PROTOCOL_ERROR');
	}
}
function parseMessage(value: unknown, includeContent: boolean): Message {
	if (!object(value)) throw new LibrusError('PROTOCOL_ERROR');
	const strings = [
		'messageId',
		'senderFirstName',
		'senderLastName',
		'senderName',
		'topic',
		'sendDate',
	] as const;
	if (
		strings.some((key) => typeof value[key] !== 'string') ||
		!value.messageId ||
		!(
			value.readDate === undefined ||
			value.readDate === null ||
			typeof value.readDate === 'string'
		) ||
		!(
			value.category === undefined ||
			value.category === null ||
			typeof value.category === 'string'
		) ||
		typeof value.isAnyFileAttached !== 'boolean' ||
		!Array.isArray(value.tags) ||
		value.tags.some((tag: unknown) => typeof tag !== 'string')
	)
		throw new LibrusError('PROTOCOL_ERROR');
	const result = Object.fromEntries(strings.map((key) => [key, value[key]])) as unknown as Message;
	result.readDate = value.readDate ?? null;
	result.category = value.category ?? null;
	result.isAnyFileAttached = value.isAnyFileAttached;
	result.tags = value.tags as string[];
	if (includeContent) {
		result.content = decodeContent(value.content);
		result.contentSource = 'preview';
	}
	return result;
}

/** A fresh, isolated browser session. No cookies or credentials enter node output. */
export class LibrusClient {
	private jar = new CookieJar();
	private deadline = 0;
	private requests = 0;
	constructor(
		private readonly transport: Transport,
		private readonly login: Login,
	) {}

	private async request(value: string, body?: string): Promise<Response & { url: URL }> {
		let url = checkedUrl(value);
		for (let hop = 0; hop <= 10; hop++) {
			if (++this.requests > 100 || Date.now() >= this.deadline)
				throw new LibrusError('SCAN_INCOMPLETE');
			if (body !== undefined && !authUrl(url)) throw new LibrusError('UNSAFE_URL');
			const headers: Record<string, string> = {
				Accept: 'application/json, text/html;q=0.9',
				'User-Agent': 'n8n-nodes-librus/0.1',
			};
			const cookie = await this.jar.getCookieString(url.href);
			if (cookie) headers.Cookie = cookie;
			if (body !== undefined) headers['Content-Type'] = 'application/x-www-form-urlencoded';
			const remaining = this.deadline - Date.now();
			if (remaining <= 0) throw new LibrusError('SCAN_INCOMPLETE');
			let response: Response;
			try {
				response = await this.transport({
					url: url.href,
					method: body === undefined ? 'GET' : 'POST',
					headers,
					body,
					timeout: Math.max(1, Math.min(15000, remaining)),
				});
			} catch {
				throw new LibrusError('TRANSPORT_ERROR');
			}
			if (typeof response.body !== 'string' || response.body.length > 10_000_000)
				throw new LibrusError('PROTOCOL_ERROR');
			const normalized = Object.fromEntries(
				Object.entries(response.headers).map(([key, val]) => [key.toLowerCase(), val]),
			);
			const cookies = normalized['set-cookie'];
			for (const entry of cookies === undefined
				? []
				: Array.isArray(cookies)
					? cookies
					: [cookies]) {
				try {
					await this.jar.setCookie(entry, url.href);
				} catch {
					throw new LibrusError('PROTOCOL_ERROR');
				}
			}
			if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
				// Never replay a credential-bearing POST, including on a same-host redirect.
				if (body !== undefined) throw new LibrusError('PROTOCOL_ERROR');
				const location = normalized.location;
				if (typeof location !== 'string') throw new LibrusError('PROTOCOL_ERROR');
				url = checkedRedirect(location, url.href);
				continue;
			}
			if (response.statusCode === 429) throw new LibrusError('RATE_LIMITED');
			if (response.statusCode === 401) throw new LibrusError('SESSION_EXPIRED');
			if (
				(response.statusCode === 403 || response.statusCode === 200) &&
				url.hostname === 'wiadomosci.librus.pl' &&
				/^\/api\/inbox\/messages(?:\/[A-Za-z0-9_-]+)?$/.test(url.pathname) &&
				isLoginForm(response.body)
			)
				throw new LibrusError('SESSION_EXPIRED');
			if (response.statusCode === 403) throw new LibrusError('ACCESS_DENIED');
			if (response.statusCode < 200 || response.statusCode >= 300)
				throw new LibrusError('SERVICE_ERROR');
			return { ...response, url };
		}
		throw new LibrusError('PROTOCOL_ERROR');
	}

	private async authenticate(): Promise<void> {
		this.jar = new CookieJar();
		const entry = await this.request('https://synergia.librus.pl/loguj/portalRodzina');
		if (!authUrl(entry.url)) throw actionRequired('login entry', entry.url);
		const form = new URLSearchParams({
			action: 'login',
			login: this.login.username,
			pass: this.login.password,
		});
		const loginReply = await this.request(entry.url.href, form.toString());
		if (isHtml(loginReply.body)) throw actionRequired('credential submission', loginReply.url);
		const reply = parseJson(loginReply.body);
		if (!object(reply) || typeof reply.goTo !== 'string' || !reply.goTo)
			throw new LibrusError('AUTH_FAILED');
		const continuation = checkedUrl(reply.goTo, 'https://api.librus.pl');
		if (!authUrl(continuation)) throw new LibrusError('UNSAFE_URL');
		const authorized = await this.request(continuation.href);
		if (
			authorized.url.hostname !== 'synergia.librus.pl' ||
			(/\/loguj(?:\/|$)/.test(authorized.url.pathname) &&
				!/^\/loguj\/portalRodzina\/?$/.test(authorized.url.pathname)) ||
			isLoginForm(authorized.body)
		)
			throw actionRequired('authorization continuation', authorized.url);
		await this.request('https://synergia.librus.pl/gateway/api/2.0/Auth/TokenInfo/');
		const inbox = await this.request('https://synergia.librus.pl/wiadomosci3');
		if (authUrl(inbox.url) || /\/loguj(?:\/|$)/.test(inbox.url.pathname))
			throw actionRequired('messages initialization', inbox.url);
	}

	async getMessages(options: Scan): Promise<Message[]> {
		if (
			!this.login.username ||
			!this.login.password ||
			!Number.isInteger(options.limit) ||
			options.limit < 1 ||
			options.limit > 1000 ||
			!Number.isInteger(options.maxPages) ||
			options.maxPages < 1 ||
			options.maxPages > 50 ||
			(options.readStatus !== undefined &&
				!['all', 'unread', 'read'].includes(options.readStatus)) ||
			(options.contentSource !== undefined &&
				options.contentSource !== 'preview' &&
				options.contentSource !== 'full')
		)
			throw new LibrusError('INVALID_OPTIONS');
		this.deadline = Date.now() + 120000;
		this.requests = 0;
		await this.authenticate();
		let unreadSelection: Message[] | undefined;
		for (let attempt = 0; attempt < 2; attempt++) {
			try {
				// Detail reads can change the unread filter. Keep its completed selection on session recovery.
				const result = unreadSelection ?? (await this.scan(options));
				if (options.includeContent && options.contentSource === 'full') {
					if (result.length > 50) throw new LibrusError('FULL_CONTENT_LIMIT');
					if (options.readStatus === 'unread') unreadSelection = result;
					for (const message of result) {
						message.content = await this.fullContent(message.messageId);
						message.contentSource = 'full';
					}
				}
				return result;
			} catch (error) {
				if (!(error instanceof LibrusError) || error.code !== 'SESSION_EXPIRED' || attempt === 1)
					throw error;
				await this.authenticate();
			}
		}
		throw new LibrusError('SESSION_EXPIRED');
	}

	async getMessageContent(
		messageId: string,
	): Promise<{ messageId: string; content: string; contentSource: 'full' }> {
		if (
			!this.login.username ||
			!this.login.password ||
			typeof messageId !== 'string' ||
			!/^[A-Za-z0-9_-]+$/.test(messageId)
		)
			throw new LibrusError('INVALID_OPTIONS');
		this.deadline = Date.now() + 120000;
		this.requests = 0;
		await this.authenticate();
		for (let attempt = 0; attempt < 2; attempt++) {
			try {
				return { messageId, content: await this.fullContent(messageId), contentSource: 'full' };
			} catch (error) {
				if (!(error instanceof LibrusError) || error.code !== 'SESSION_EXPIRED' || attempt === 1)
					throw error;
				await this.authenticate();
			}
		}
		throw new LibrusError('SESSION_EXPIRED');
	}

	private async fullContent(messageId: string): Promise<string> {
		if (!/^[A-Za-z0-9_-]+$/.test(messageId)) throw new LibrusError('PROTOCOL_ERROR');
		const path = `/api/inbox/messages/${encodeURIComponent(messageId)}`;
		const response = await this.request(`https://wiadomosci.librus.pl${path}`);
		if (authUrl(response.url) || /\/loguj(?:\/|$)/.test(response.url.pathname))
			throw new LibrusError('SESSION_EXPIRED');
		if (response.url.hostname !== 'wiadomosci.librus.pl' || response.url.pathname !== path)
			throw new LibrusError('PROTOCOL_ERROR');
		const payload = parseJson(response.body);
		if (!object(payload) || !object(payload.data) || payload.data.messageId !== messageId)
			throw new LibrusError('PROTOCOL_ERROR');
		return decodeContent(payload.data.Message);
	}

	private async scan(options: Scan): Promise<Message[]> {
		const pageSize =
			options.returnAll || (options.readStatus && options.readStatus !== 'all')
				? 50
				: Math.min(50, options.limit);
		const found = new Map<string, Message>();
		const scanned = new Set<string>();
		for (let page = 1; page <= options.maxPages; page++) {
			const response = await this.request(
				`https://wiadomosci.librus.pl/api/inbox/messages?page=${page}&limit=${pageSize}`,
			);
			if (authUrl(response.url) || /\/loguj(?:\/|$)/.test(response.url.pathname))
				throw new LibrusError('SESSION_EXPIRED');
			if (
				response.url.hostname !== 'wiadomosci.librus.pl' ||
				response.url.pathname !== '/api/inbox/messages'
			)
				throw new LibrusError('PROTOCOL_ERROR');
			const payload = parseJson(response.body);
			if (!object(payload) || !Array.isArray(payload.data) || payload.data.length > pageSize)
				throw new LibrusError('PROTOCOL_ERROR');
			const before = scanned.size;
			for (const raw of payload.data) {
				const message = parseMessage(
					raw,
					options.includeContent && options.contentSource !== 'full',
				);
				scanned.add(message.messageId);
				const unread = message.readDate === null || message.readDate === '';
				if (
					!options.readStatus ||
					options.readStatus === 'all' ||
					(options.readStatus === 'unread' ? unread : !unread)
				)
					found.set(message.messageId, message);
			}
			if (!options.returnAll && found.size >= options.limit)
				return [...found.values()].slice(0, options.limit);
			if (payload.data.length === 0) return [...found.values()];
			if (scanned.size === before) throw new LibrusError('SCAN_INCOMPLETE');
			if (payload.data.length < pageSize) return [...found.values()];
		}
		throw new LibrusError('SCAN_INCOMPLETE');
	}
}
