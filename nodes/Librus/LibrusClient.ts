import { CookieJar } from 'tough-cookie';

import {
	type AuthDestination,
	type AuthStage,
	LibrusError,
	protocolError as baseProtocolError,
	safeError,
} from './errors';
import { parseEventDetail, parseMonth, type CalendarDetail, type CalendarEntry } from './terminarz';
import type { SessionCache } from './sessionCache';
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
export interface ClientOptions {
	/** Reuse one logged-in session across clients. Without it every operation logs in. */
	sessions?: SessionCache;
	/** Receives session lifecycle notes. They never contain credentials, cookies or content. */
	log?: (message: string) => void;
	/**
	 * The proxy the transport routes through, as a URL. Only hashed into the session key and
	 * flagged in transport errors; never shown.
	 */
	proxy?: string;
}
type Budget = 'SCAN_INCOMPLETE' | 'CALENDAR_SCAN_INCOMPLETE';
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
	| 'adres wydarzenia terminarza'
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
/** HTTP requests one operation attempt may make, redirect hops included. */
const MAX_REQUESTS = 100;
/** Redirect hops one `request()` call follows before it gives up. */
const MAX_REDIRECTS = 10;
/**
 * Requests to leave unspent before starting another detail fetch: the fetch itself plus
 * every redirect hop it may follow (1 + MAX_REDIRECTS). Below that, hydration stops
 * instead of risking the budget error mid-fetch. Keys left unfetched are simply absent
 * from the details map, which the state module retries on the next poll, so the poll
 * still commits; throwing here would discard the whole scan and make a persistent
 * redirect pattern retry the same backlog forever.
 */
const DETAIL_HEADROOM = MAX_REDIRECTS + 1;
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
/**
 * A code-owned label for why a request never got an HTTP response, such as ETIMEDOUT or
 * ECONNRESET. Only system-style error codes pass; messages are never copied.
 */
function transportCause(cause: unknown): string {
	const nested = object(cause) ? cause.cause : undefined;
	for (const candidate of [cause, nested]) {
		const code = object(candidate) ? candidate.code : undefined;
		if (typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,40}$/.test(code)) return code;
	}
	return cause instanceof Error && /timeout/i.test(cause.message) ? 'TIMEOUT' : 'nieznana';
}
function minutes(ms: number): number {
	return Math.max(0, Math.round(ms / 60000));
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
	/**
	 * Which exhausted-budget message the current operation should raise. The message
	 * names the parameter the user can actually turn down, and the calendar events have
	 * no "Maksymalna liczba stron".
	 */
	private budgetCode: Budget = 'SCAN_INCOMPLETE';
	/** When the session in `jar` was established, for the age reported in session notes. */
	private sessionStart = 0;
	private cacheKey?: string;
	constructor(
		private readonly transport: Transport,
		private readonly login: Login,
		private readonly options: ClientOptions = {},
	) {}

	private note(message: string): void {
		this.options.log?.(`Librus: ${message}`);
	}

	private key(sessions: SessionCache): string {
		this.cacheKey ??= sessions.key(this.login.username, this.login.password, this.options.proxy);
		return this.cacheKey;
	}

	/** Adopts a stored session. Returns false when there is none to reuse. */
	private restoreSession(): boolean {
		const sessions = this.options.sessions;
		if (!sessions) return false;
		const stored = sessions.lookup(this.key(sessions));
		if (stored.status === 'expired')
			this.note(`zapisana sesja osiągnęła limit wieku (${minutes(stored.ageMs)} min)`);
		if (stored.status !== 'ok') return false;
		this.jar = stored.jar;
		this.sessionStart = stored.establishedAt;
		this.note(`używam zapisanej sesji (wiek: ${minutes(stored.ageMs)} min)`);
		return true;
	}

	private forgetSession(): void {
		const sessions = this.options.sessions;
		if (sessions) sessions.forget(this.key(sessions));
	}

	/**
	 * Runs one operation on a logged-in session: a stored one when available, otherwise a
	 * fresh login. A session that stops working is logged in again once. Any failure drops
	 * the stored session, so a broken one is never offered to the next operation.
	 */
	private async withSession<T>(budget: Budget, run: () => Promise<T>): Promise<T> {
		const operation = async (): Promise<T> => {
			// The budget starts once the account is free, so queueing never eats into it.
			this.budgetCode = budget;
			this.deadline = Date.now() + 120000;
			this.requests = 0;
			let reused = this.restoreSession();
			if (!reused) await this.authenticate('brak zapisanej sesji');
			for (let attempt = 0; ; attempt++) {
				try {
					return await run();
				} catch (error) {
					this.forgetSession();
					const code = error instanceof LibrusError ? error.code : undefined;
					// An expired session does not always announce itself as one: Librus may answer
					// with a page instead of JSON or a bare 403. On a reused session those mean stale.
					const stale =
						code === 'SESSION_EXPIRED' ||
						(reused && (code === 'PROTOCOL_ERROR' || code === 'ACCESS_DENIED'));
					if (!stale || attempt === 1) throw error;
					const reason = reused
						? `zapisana sesja przestała działać po ${minutes(Date.now() - this.sessionStart)} min (${code})`
						: 'sesja wygasła w trakcie zapytania';
					reused = false;
					// A full window costs roughly 8 (login) + 7 (months) + 50 (details) requests,
					// so a late expiry would leave the retry unable to finish on a shared counter.
					// Each attempt gets its own request budget; the deadline still bounds the whole.
					this.requests = 0;
					await this.authenticate(reason);
				}
			}
		};
		const sessions = this.options.sessions;
		return sessions ? sessions.exclusive(this.key(sessions), operation) : operation();
	}

	private async request(value: string, body?: string): Promise<Response & { url: URL }> {
		let url = checkedUrl(value);
		for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
			if (++this.requests > MAX_REQUESTS || Date.now() >= this.deadline)
				throw new LibrusError(this.budgetCode);
			if (
				body !== undefined &&
				!authUrl(url) &&
				!allowedPostUrls.has(`${url.origin}${url.pathname}`)
			)
				throw new LibrusError('UNSAFE_URL');
			const headers: Record<string, string> = {
				Accept: 'application/json, text/html;q=0.9',
				'User-Agent': 'n8n-nodes-librus/0.1',
			};
			const cookie = await this.jar.getCookieString(url.href);
			if (cookie) headers.Cookie = cookie;
			if (body !== undefined) headers['Content-Type'] = 'application/x-www-form-urlencoded';
			const remaining = this.deadline - Date.now();
			if (remaining <= 0) throw new LibrusError(this.budgetCode);
			let response: Response;
			try {
				response = await this.transport({
					url: url.href,
					method: body === undefined ? 'GET' : 'POST',
					headers,
					body,
					timeout: Math.max(1, Math.min(15000, remaining)),
				});
			} catch (cause) {
				const error = new LibrusError('TRANSPORT_ERROR');
				error.message += ` [Przyczyna: ${transportCause(cause)}; host: ${url.hostname}${this.options.proxy ? '; przez proxy' : ''}]`;
				throw error;
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

	private async authenticate(reason: string): Promise<void> {
		this.note(`nowe logowanie (${reason})`);
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
			const sessions = this.options.sessions;
			this.sessionStart = sessions ? sessions.store(this.key(sessions), this.jar) : Date.now();
		} catch (error) {
			this.forgetSession();
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
		let unreadSelection: Message[] | undefined;
		return await this.withSession('SCAN_INCOMPLETE', async () => {
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
		});
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
		return await this.withSession('SCAN_INCOMPLETE', async () => ({
			messageId,
			content: await this.fullContent(messageId),
			contentSource: 'full' as const,
		}));
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
		const path = `/terminarz/${route}/${id}`;
		let response;
		try {
			response = await this.request(`https://synergia.librus.pl${path}`);
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
		// A GET follows redirects, so the body may come from another allowed page entirely.
		// Two th/td rows are enough for `parseEventDetail` to accept it, so the entry would
		// be hydrated from whatever that page happens to contain. The month form is checked
		// the same way.
		if (response.url.hostname !== 'synergia.librus.pl' || response.url.pathname !== path)
			throw protocolError('adres wydarzenia terminarza');
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
			throw new LibrusError('CALENDAR_INVALID_OPTIONS');
		return await this.withSession('CALENDAR_SCAN_INCOMPLETE', async () => {
			const entries: CalendarEntry[] = [];
			for (const month of options.months) {
				const [year, index] = month.split('-').map(Number);
				if (year < 2000 || year > 2100) throw new LibrusError('CALENDAR_INVALID_OPTIONS');
				entries.push(...(await this.monthPage(year, index)));
			}
			const known = new Map(entries.map((entry) => [entry.key, entry]));
			const selected = select(entries);
			if (!Array.isArray(selected)) throw new LibrusError('CALENDAR_INVALID_OPTIONS');
			const details = new Map<string, CalendarDetail | null>();
			// A link-less (synthetic-key) entry has nothing to fetch, so it is resolved
			// as null here and never consumes one of the MAX_DETAILS slots — a real
			// backlog of fetchable entries drains that much faster.
			const fetchable: { key: string; route: 'szczegoly' | 'szczegoly_wolne'; id: string }[] = [];
			for (const key of selected) {
				const entry = known.get(key);
				if (!entry) continue;
				if (!entry.route || !entry.eventId) {
					details.set(key, null);
					continue;
				}
				fetchable.push({ key, route: entry.route, id: entry.eventId });
			}
			// Bounded independently of the caller, by the detail cap and by what is left
			// of the request budget. Keys left out stay unresolved, which the state
			// module treats as "retry on the next poll".
			for (const { key, route, id } of fetchable.slice(0, MAX_DETAILS)) {
				if (MAX_REQUESTS - this.requests < DETAIL_HEADROOM) break;
				const detail = await this.eventDetail(route, id);
				if (detail !== null) details.set(key, detail);
			}
			return { entries, details };
		});
	}
}
