const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseProxy, proxyUrl } = require('../dist/nodes/Librus/proxy');
const {
	createTransport,
	createCredentialTestTransport,
} = require('../dist/nodes/Librus/transport');
const { LibrusClient } = require('../dist/nodes/Librus/LibrusClient');
const { SessionCache } = require('../dist/nodes/Librus/sessionCache');
const { Librus } = require('../dist/nodes/Librus/Librus.node');
const { LibrusSessionApi } = require('../dist/credentials/LibrusSessionApi.credentials');

test('an empty proxy field means a direct connection', () => {
	for (const value of [undefined, null, '', '   ']) assert.equal(parseProxy(value), undefined);
});
test('proxy addresses are parsed with default ports and decoded credentials', () => {
	assert.deepEqual(parseProxy(' http://proxy.example.pl:3128 '), {
		protocol: 'http',
		host: 'proxy.example.pl',
		port: 3128,
	});
	assert.deepEqual(parseProxy('http://10.0.0.5'), { protocol: 'http', host: '10.0.0.5', port: 80 });
	assert.deepEqual(parseProxy('https://proxy.example.pl/'), {
		protocol: 'https',
		host: 'proxy.example.pl',
		port: 443,
	});
	assert.deepEqual(parseProxy('http://us%40er:p%3Ass%20word@proxy.example.pl:8080').auth, {
		username: 'us@er',
		password: 'p:ss word',
	});
	assert.equal(parseProxy('http://[::1]:3128').host, '[::1]');
});
test('unsupported proxy addresses fail instead of silently connecting directly', () => {
	for (const value of [
		'socks5://user:synthetic-secret@proxy.example.pl:1080',
		'proxy.example.pl:3128',
		'http://proxy.example.pl:3128/path',
		'http://proxy.example.pl:3128?x=1',
		'http://proxy.example.pl:3128#x',
		'not a url synthetic-secret',
		'http://user:%E0%A4%A@proxy.example.pl',
		42,
	]) {
		assert.throws(
			() => parseProxy(value),
			(error) => {
				assert.equal(error.code, 'PROXY_INVALID');
				assert.doesNotMatch(error.message, /synthetic-secret|proxy\.example/);
				return true;
			},
			String(value),
		);
	}
});
test('proxy URL round-trips for the legacy helper, credentials included', () => {
	const proxy = parseProxy('http://us%40er:p%3Ass@proxy.example.pl:8080');
	assert.deepEqual(parseProxy(proxyUrl(proxy)), proxy);
	assert.equal(proxyUrl(parseProxy('https://proxy.example.pl')), 'https://proxy.example.pl/');
});
test('the execution transport passes the proxy to n8n only when one is set', async () => {
	const seen = [];
	const helper = async (options) => {
		seen.push(options);
		return { statusCode: 200, headers: {}, body: '' };
	};
	const request = { url: 'https://synergia.librus.pl/', method: 'GET', headers: {}, timeout: 1 };
	await createTransport(helper)(request);
	const proxy = parseProxy('http://u:p@proxy.example.pl:3128');
	await createTransport(helper, proxy)(request);
	assert.equal('proxy' in seen[0], false);
	assert.deepEqual(seen[1].proxy, proxy);
	assert.equal(seen[1].disableFollowRedirect, true);
});
test('the credential-test transport passes the proxy as a URL', async () => {
	let seen;
	const helper = async (options) => {
		seen = options;
		return { statusCode: 200, headers: {}, body: '' };
	};
	const proxy = parseProxy('http://u:p@proxy.example.pl:3128');
	await createCredentialTestTransport(
		helper,
		proxy,
	)({
		url: 'https://synergia.librus.pl/',
		method: 'GET',
		headers: {},
		timeout: 1,
	});
	assert.equal(seen.proxy, 'http://u:p@proxy.example.pl:3128/');
});
test('a transport error through a proxy says so without revealing the proxy', async () => {
	const client = new LibrusClient(
		async () => {
			throw Object.assign(new Error('x'), { code: 'ECONNREFUSED' });
		},
		{ username: 'synthetic-login', password: 'synthetic-password' },
		{ proxy: 'http://u:synthetic-secret@proxy.example.pl:3128/' },
	);
	await assert.rejects(
		client.getMessages({ returnAll: false, limit: 1, maxPages: 1, includeContent: false }),
		(error) => {
			assert.equal(error.code, 'TRANSPORT_ERROR');
			assert.match(
				error.message,
				/Przyczyna: ECONNREFUSED; host: synergia\.librus\.pl; przez proxy\]/,
			);
			assert.doesNotMatch(error.message, /synthetic-secret|proxy\.example/);
			return true;
		},
	);
});
test('sessions made through different proxies are kept apart', () => {
	const sessions = new SessionCache();
	const direct = sessions.key('login', 'password');
	assert.notEqual(direct, sessions.key('login', 'password', 'http://proxy.example.pl:3128/'));
	assert.equal(direct, sessions.key('login', 'password', ''));
});
test('the credential offers an optional, masked proxy field', () => {
	const field = new LibrusSessionApi().properties.find((p) => p.name === 'proxyUrl');
	assert.equal(field.type, 'string');
	assert.equal(field.typeOptions.password, true);
	assert.equal(field.default, '');
	assert.notEqual(field.required, true);
});
function nodeContext(proxyUrlValue, seen) {
	return {
		getInputData: () => [{ json: {} }],
		getNodeParameter: (name) =>
			({
				resource: 'message',
				operation: 'getAll',
				returnAll: false,
				limit: 1,
				maxPages: 1,
				includeContent: false,
			})[name],
		getCredentials: async () => ({
			username: 'synthetic',
			password: 'secret-password',
			proxyUrl: proxyUrlValue,
		}),
		helpers: {
			httpRequest: async (options) => {
				seen.push(options);
				throw new Error('secret-password');
			},
		},
		continueOnFail: () => true,
		getNode: () => ({
			id: 't',
			name: 'Librus',
			type: 'librus',
			typeVersion: 1,
			position: [0, 0],
			parameters: {},
		}),
	};
}
test('the action node routes through the credential proxy', async () => {
	const seen = [];
	const result = await new Librus().execute.call(
		nodeContext('http://u:p@proxy.example.pl:3128', seen),
		[],
	);
	assert.equal(seen[0].proxy.host, 'proxy.example.pl');
	assert.equal(result[0][0].json.code, 'TRANSPORT_ERROR');
	assert.match(result[0][0].json.error, /przez proxy/);
});
test('an invalid proxy stops the node before any request, without echoing it', async () => {
	const seen = [];
	const result = await new Librus().execute.call(
		nodeContext('socks5://u:secret-proxy-pass@proxy.example.pl:1080', seen),
		[],
	);
	assert.equal(seen.length, 0);
	assert.equal(result[0][0].json.code, 'PROXY_INVALID');
	assert.doesNotMatch(JSON.stringify(result), /secret-proxy-pass|proxy\.example/);
});
