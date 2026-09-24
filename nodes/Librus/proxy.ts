import { LibrusError } from './errors';

/** The shape n8n's `httpRequest` helper accepts as `proxy`. */
export interface ProxyConfig {
	protocol: 'http' | 'https';
	host: string;
	port: number;
	auth?: { username: string; password: string };
}

/**
 * Reads the optional proxy address from the credential. Empty means a direct connection.
 *
 * Validation is strict on purpose: n8n silently falls back to a direct connection for a proxy
 * address it does not support, which would send Librus traffic from the server's own IP while
 * the user believes it goes through the proxy. Errors never echo the value, which may hold a
 * password.
 */
export function parseProxy(value: unknown): ProxyConfig | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== 'string') throw new LibrusError('PROXY_INVALID');
	const text = value.trim();
	if (!text) return undefined;
	let url: URL;
	try {
		url = new URL(text);
	} catch {
		throw new LibrusError('PROXY_INVALID');
	}
	if (
		(url.protocol !== 'http:' && url.protocol !== 'https:') ||
		!url.hostname ||
		(url.pathname !== '/' && url.pathname !== '') ||
		url.search ||
		url.hash
	)
		throw new LibrusError('PROXY_INVALID');
	const protocol = url.protocol === 'https:' ? 'https' : 'http';
	const config: ProxyConfig = {
		protocol,
		// URL keeps IPv6 literals bracketed; n8n rebuilds the address as `protocol://host`.
		host: url.hostname,
		port: url.port ? Number(url.port) : protocol === 'https' ? 443 : 80,
	};
	if (url.username || url.password) {
		try {
			config.auth = {
				username: decodeURIComponent(url.username),
				password: decodeURIComponent(url.password),
			};
		} catch {
			throw new LibrusError('PROXY_INVALID');
		}
	}
	return config;
}

/** The same proxy as one URL, for the legacy request helper used by the credential test. */
export function proxyUrl(proxy: ProxyConfig): string {
	const url = new URL(`${proxy.protocol}://${proxy.host}`);
	url.port = String(proxy.port);
	if (proxy.auth) {
		url.username = encodeURIComponent(proxy.auth.username);
		url.password = encodeURIComponent(proxy.auth.password);
	}
	return url.href;
}
