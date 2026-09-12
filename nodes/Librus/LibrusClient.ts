import { CookieJar } from 'tough-cookie';

import {
	type AuthDestination,
	type AuthStage,
	LibrusError,
	protocolError as baseProtocolError,
	safeError,
} from './errors';
import { parseEventDetail, parseMonth, type CalendarDetail, type CalendarEntry } from './terminarz';
export { LibrusError, safeError };

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
export interface CalendarScan {
	months: string[]; // 'YYYY-MM', 1..7 entries, ascending
}
export type CalendarSelect = (entries: CalendarEntry[]) => string[];
export interface CalendarResult {
	entries: CalendarEntry[];
	details: Map<string, CalendarDetail | null>;
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

// Diagnostics contain only code-owned labels and primitive type names, never values.
type ProtocolCheck =
	| `message.${keyof Message}`
	| 'obiekt wiadomości'
	| 'odpowiedź JSON'
	| 'HTML zamiast JSON'
	| 'treść base64'
	| 'treść UTF-8'
	| 'typ treści odpowiedzi HTTP'
	| 'rozmiar odpowiedzi HTTP'
	| 'ciasteczko odpowiedzi'
	| 'przekierowanie POST'
	| 'adres przekierowania'
	| 'limit przekierowań'
	| 'adres skrzynki'
	| 'adres terminarza'
	| 'obiekt odpowiedzi skrzynki'
	| 'tablica wiadomości'
	| 'liczba wiadomości na stronie';
function protocolError(check: ProtocolCheck, value?: unknown): LibrusError {
	return baseProtocolError(check, value);
}
const allowedHosts = new Set([
	'portal.librus.pl',
	'synergia.librus.pl',
	'api.librus.pl',
	'wiadomosci.librus.pl',
]);
// Credential-free POST targets. The password may still only leave through the OAuth route.
const allowedPostUrls = new Set(['https://synergia.librus.pl/terminarz']);
/** Detail fetches per calendar poll. calendarState.MAX_HYDRATION must not exceed this. */
const MAX_DETAILS = 50;
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
				? 'adres bez HTTPS'
				: url.username || url.password
					? 'dane logowania w adresie URL'
					: url.port
						? 'niestandardowy port'
						: 'nierozpoznana domena';
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
		? 'autoryzacja OAuth'
		: url.hostname === 'synergia.librus.pl' && url.pathname === '/loguj/portalRodzina'
			? 'powrót OAuth do Synergii'
			: url.hostname === 'synergia.librus.pl' && /^\/loguj(?:\/|$)/.test(url.pathname)
				? 'logowanie do Synergii'
				: url.hostname === 'synergia.librus.pl'
					? 'strona Synergii'
					: url.hostname === 'wiadomosci.librus.pl'
						? 'serwis wiadomości'
						: 'inna dozwolona strona';
	return new LibrusError('ACTION_REQUIRED', stage, destination);
}
function object(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function parseJson(body: string): unknown {
	try {
		return JSON.parse(body);
	} catch {
		throw protocolError(isHtml(body) ? 'HTML zamiast JSON' : 'odpowiedź JSON', body);
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
		throw protocolError('treść base64', value);
	}
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(value, 'base64'));
	} catch {
		throw protocolError('treść UTF-8', value);
	}
}
// The Librus web UI reads message tags as objects with an id field.
// Preserve our string-array output and copy only IDs, never arbitrary tag properties.
function parseTags(value: unknown): string[] {
	if (!Array.isArray(value)) throw protocolError('message.tags', value);
	return value.map((tag: unknown) => {
		if (typeof tag === 'string') return tag;
		if (object(tag)) {
			if (typeof tag.id === 'string' && tag.id) return tag.id;
			if (typeof tag.id === 'number' && Number.isSafeInteger(tag.id) && tag.id >= 0)
				return String(tag.id);
		}
		throw protocolError('message.tags', tag);
	});
}
function parseMessage(value: unknown, includeContent: boolean): Message {
	if (!object(value)) throw protocolError('obiekt wiadomości', value);
	const strings = [
		'messageId',
		'senderFirstName',
		'senderLastName',
		'senderName',
		'topic',
		'sendDate',
	] as const;
	for (const key of strings) {
		if (typeof value[key] !== 'string' || (key === 'messageId' && !value[key]))
			throw protocolError(`message.${key}`, value[key]);
	}
	const result = Object.fromEntries(strings.map((key) => [key, value[key]])) as unknown as Message;
	for (const key of ['readDate', 'category'] as const) {
		const field = value[key];
		if (field !== undefined && field !== null && typeof field !== 'string')
			throw protocolError(`message.${key}`, field);
		result[key] = field ?? null;
	}
	if (typeof value.isAnyFileAttached !== 'boolean')
		throw protocolError('message.isAnyFileAttached', value.isAnyFileAttached);
	result.isAnyFileAttached = value.isAnyFileAttached;
	result.tags = parseTags(value.tags);
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
			if (body !== undefined && !authUrl(url) && !allowedPostUrls.has(`${url.origin}${url.pathname}`))
				throw new LibrusError('UNSAFE_URL');
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
			if (typeof response.body !== 'string')
				throw protocolError('typ treści odpowiedzi HTTP', response.body);
			if (response.body.length > 10_000_000) throw protocolError('rozmiar odpowiedzi HTTP');
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
					throw protocolError('ciasteczko odpowiedzi');
				}
			}
			if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
				// Never replay a credential-bearing POST, including on a same-host redirect.
				if (body !== undefined) {
					const location = normalized.location;
					if (!authUrl(url) && typeof location === 'string') {
						let target: URL | undefined;
						try {
							target = checkedRedirect(location, url.href);
						} catch {
							target = undefined;
						}
						if (target && (authUrl(target) || /^\/loguj(?:\/|$)/.test(target.pathname)))
							throw new LibrusError('SESSION_EXPIRED');
					}
					throw protocolError('przekierowanie POST');
				}
				const location = normalized.location;
				if (typeof location !== 'string') throw protocolError('adres przekierowania', location);
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
			if (response.statusCode < 200 || response.statusCode >= 300) {
				const error = new LibrusError('SERVICE_ERROR');
				error.status = response.statusCode;
				throw error;
			}
			return { ...response, url };
		}
		throw protocolError('limit przekierowań');
	}

	private async authenticate(): Promise<void> {
		try {
			this.jar = new CookieJar();
			const entry = await this.request('https://synergia.librus.pl/loguj/portalRodzina');
			if (!authUrl(entry.url)) throw actionRequired('rozpoczęcie logowania', entry.url);
			const form = new URLSearchParams({
				action: 'login',
				login: this.login.username,
				pass: this.login.password,
			});
			const loginReply = await this.request(entry.url.href, form.toString());
			if (isHtml(loginReply.body))
				throw actionRequired('przesłanie danych logowania', loginReply.url);
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
				throw actionRequired('kontynuacja autoryzacji', authorized.url);
			await this.request('https://synergia.librus.pl/gateway/api/2.0/Auth/TokenInfo/');
			const inbox = await this.request('https://synergia.librus.pl/wiadomosci3');
			if (authUrl(inbox.url) || /\/loguj(?:\/|$)/.test(inbox.url.pathname))
				throw actionRequired('otwarcie skrzynki', inbox.url);
		} catch (error) {
			if (error instanceof LibrusError && error.code === 'PROTOCOL_ERROR')
				error.message += ' [Faza: logowanie]';
			throw error;
		}
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
			let itemIndex: number | undefined;
			try {
				const response = await this.request(
					`https://wiadomosci.librus.pl/api/inbox/messages?page=${page}&limit=${pageSize}`,
				);
				if (authUrl(response.url) || /\/loguj(?:\/|$)/.test(response.url.pathname))
					throw new LibrusError('SESSION_EXPIRED');
				if (
					response.url.hostname !== 'wiadomosci.librus.pl' ||
					response.url.pathname !== '/api/inbox/messages'
				)
					throw protocolError('adres skrzynki');
				const payload = parseJson(response.body);
				if (!object(payload)) throw protocolError('obiekt odpowiedzi skrzynki', payload);
				if (!Array.isArray(payload.data)) throw protocolError('tablica wiadomości', payload.data);
				if (payload.data.length > pageSize)
					throw protocolError('liczba wiadomości na stronie', payload.data);
				const before = scanned.size;
				for (const [index, raw] of payload.data.entries()) {
					itemIndex = index + 1;
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
			} catch (error) {
				if (error instanceof LibrusError && error.code === 'PROTOCOL_ERROR') {
					error.message += ` [Strona skrzynki: ${page}; rozmiar strony: ${pageSize}${itemIndex === undefined ? '' : `; pozycja: ${itemIndex}`}]`;
				}
				throw error;
			}
		}
		throw new LibrusError('SCAN_INCOMPLETE');
	}

	private async monthPage(year: number, month: number): Promise<CalendarEntry[]> {
		const body = new URLSearchParams({
			rok: String(year),
			miesiac: String(month),
		}).toString();
		const response = await this.request('https://synergia.librus.pl/terminarz', body);
		if (
			authUrl(response.url) ||
			/\/loguj(?:\/|$)/.test(response.url.pathname) ||
			isLoginForm(response.body)
		)
			throw new LibrusError('SESSION_EXPIRED');
		if (
			response.url.hostname !== 'synergia.librus.pl' ||
			!/^\/terminarz\/?$/.test(response.url.pathname)
		)
			throw protocolError('adres terminarza');
		try {
			return parseMonth(response.body, year, month);
		} catch (error) {
			if (error instanceof LibrusError && error.code === 'PROTOCOL_ERROR')
				error.message += ` [Miesiąc terminarza: ${year}-${String(month).padStart(2, '0')}]`;
			throw error;
		}
	}

	private async eventDetail(route: string, id: string): Promise<CalendarDetail | null> {
		if ((route !== 'szczegoly' && route !== 'szczegoly_wolne') || !/^\d+$/.test(id))
			throw new LibrusError('PROTOCOL_ERROR');
		let response;
		try {
			response = await this.request(`https://synergia.librus.pl/terminarz/${route}/${id}`);
		} catch (error) {
			// The entry disappeared between the scan and hydration. Leave it unresolved.
			if (error instanceof LibrusError && error.code === 'SERVICE_ERROR' && error.status === 404)
				return null;
			throw error;
		}
		if (
			authUrl(response.url) ||
			/\/loguj(?:\/|$)/.test(response.url.pathname) ||
			isLoginForm(response.body)
		)
			throw new LibrusError('SESSION_EXPIRED');
		return parseEventDetail(response.body);
	}

	async getCalendar(options: CalendarScan, select: CalendarSelect): Promise<CalendarResult> {
		if (
			!this.login.username ||
			!this.login.password ||
			typeof select !== 'function' ||
			!Array.isArray(options.months) ||
			options.months.length < 1 ||
			options.months.length > 7 ||
			options.months.some((month) => !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month))
		)
			throw new LibrusError('INVALID_OPTIONS');
		this.deadline = Date.now() + 120000;
		this.requests = 0;
		await this.authenticate();
		for (let attempt = 0; attempt < 2; attempt++) {
			try {
				const entries: CalendarEntry[] = [];
				for (const month of options.months) {
					const [year, index] = month.split('-').map(Number);
					if (year < 2000 || year > 2100) throw new LibrusError('INVALID_OPTIONS');
					entries.push(...(await this.monthPage(year, index)));
				}
				const known = new Map(entries.map((entry) => [entry.key, entry]));
				const selected = select(entries);
				if (!Array.isArray(selected)) throw new LibrusError('INVALID_OPTIONS');
				const details = new Map<string, CalendarDetail | null>();
				// Bounded independently of the caller. Keys left out stay unresolved,
				// which the state module treats as "retry on the next poll".
				for (const key of selected.slice(0, MAX_DETAILS)) {
					const entry = known.get(key);
					if (!entry) continue;
					if (!entry.route || !entry.eventId) {
						details.set(key, null);
						continue;
					}
					const detail = await this.eventDetail(entry.route, entry.eventId);
					if (detail !== null) details.set(key, detail);
				}
				return { entries, details };
			} catch (error) {
				if (!(error instanceof LibrusError) || error.code !== 'SESSION_EXPIRED' || attempt === 1)
					throw error;
				await this.authenticate();
			}
		}
		throw new LibrusError('SESSION_EXPIRED');
	}
}
