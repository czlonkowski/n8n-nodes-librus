import { createHash } from 'node:crypto';
import type { CookieJar } from 'tough-cookie';

/**
 * Longest a stored session is offered for reuse. Librus's own limit is unknown; a session it
 * has already ended is detected on first use and replaced, so this only bounds how long a
 * session that keeps working is trusted.
 */
export const MAX_SESSION_AGE_MS = 6 * 60 * 60 * 1000;

export type SessionLookup =
	| { status: 'none' }
	| { status: 'expired'; ageMs: number }
	| { status: 'ok'; jar: CookieJar; establishedAt: number; ageMs: number };

/**
 * Librus browser sessions shared by every client in one n8n process, keyed by a hash of the
 * login and password. Memory only: the session cookies are as good as the password, so they
 * never go to workflow static data, node output or logs. A restart simply logs in again.
 */
export class SessionCache {
	private readonly sessions = new Map<string, { jar: CookieJar; establishedAt: number }>();
	private readonly queues = new Map<string, Promise<unknown>>();

	constructor(readonly now: () => number = Date.now) {}

	/** `route` separates sessions made through different proxies (or none). */
	key(username: string, password: string, route = ''): string {
		return createHash('sha256')
			.update(username)
			.update('\0')
			.update(password)
			.update('\0')
			.update(route)
			.digest('hex');
	}

	lookup(key: string): SessionLookup {
		const stored = this.sessions.get(key);
		if (!stored) return { status: 'none' };
		const ageMs = this.now() - stored.establishedAt;
		if (ageMs >= MAX_SESSION_AGE_MS) {
			this.sessions.delete(key);
			return { status: 'expired', ageMs };
		}
		return { status: 'ok', jar: stored.jar, establishedAt: stored.establishedAt, ageMs };
	}

	store(key: string, jar: CookieJar): number {
		const establishedAt = this.now();
		this.sessions.set(key, { jar, establishedAt });
		return establishedAt;
	}

	forget(key: string): void {
		this.sessions.delete(key);
	}

	/**
	 * Runs operations on one account one at a time, so two triggers never log in concurrently
	 * and no operation swaps the cookie jar under another one mid-request.
	 */
	async exclusive<T>(key: string, run: () => Promise<T>): Promise<T> {
		const previous = this.queues.get(key) ?? Promise.resolve();
		const current = previous.then(run, run);
		const tail = current.then(
			() => undefined,
			() => undefined,
		);
		this.queues.set(key, tail);
		try {
			return await current;
		} finally {
			if (this.queues.get(key) === tail) this.queues.delete(key);
		}
	}
}

/** The process-wide cache the n8n nodes share. Tests create their own instances. */
export const sharedSessions = new SessionCache();
