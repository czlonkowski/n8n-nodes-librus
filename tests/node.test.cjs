const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Librus } = require('../dist/nodes/Librus/Librus.node');
const { LibrusSessionApi } = require('../dist/credentials/LibrusSessionApi.credentials');
const {
	createTransport,
	createCredentialTestTransport,
} = require('../dist/nodes/Librus/transport');

test('package entry points load and reference the existing credentials and icons', () => {
	const fs = require('node:fs');
	const pkg = require('../package.json');
	for (const file of [...pkg.n8n.nodes, ...pkg.n8n.credentials]) assert.ok(fs.existsSync(file));
	const node = new Librus();
	assert.equal(node.description.credentials[0].name, new LibrusSessionApi().name);
	assert.equal(
		typeof node.methods.credentialTest[node.description.credentials[0].testedBy],
		'function',
	);
	for (const icon of typeof node.description.icon === 'string'
		? [node.description.icon]
		: Object.values(node.description.icon))
		assert.ok(fs.existsSync(`dist/nodes/Librus/${icon.slice(5)}`));
});
test('both transport adapters disable automatic redirects and preserve response fields', async () => {
	const request = {
		url: 'https://api.librus.pl/OAuth/Authorization',
		method: 'POST',
		headers: {},
		body: 'synthetic',
		timeout: 1000,
	};
	const response = { statusCode: 302, headers: { location: '/next' }, body: '' };
	let modern, legacy;
	assert.deepEqual(
		await createTransport(async (options) => {
			modern = options;
			return response;
		})(request),
		response,
	);
	assert.deepEqual(
		await createCredentialTestTransport(async (options) => {
			legacy = options;
			return response;
		})(request),
		response,
	);
	assert.equal(modern.disableFollowRedirect, true);
	assert.equal(modern.returnFullResponse, true);
	assert.equal(modern.ignoreHttpStatusErrors, true);
	assert.equal(modern.encoding, 'text');
	assert.equal(legacy.followRedirect, false);
	assert.equal(legacy.followAllRedirects, false);
	assert.equal(legacy.resolveWithFullResponse, true);
	assert.equal(legacy.simple, false);
});
function context(continueOnFail) {
	return {
		getInputData: () => [{ json: { privateInput: 'do-not-copy' } }, { json: {} }],
		getNodeParameter: (name) =>
			({
				resource: 'message',
				operation: 'getAll',
				returnAll: false,
				limit: 1,
				maxPages: 1,
				includeContent: false,
			})[name],
		getCredentials: async () => ({ username: 'synthetic', password: 'secret-password' }),
		helpers: {
			httpRequest: async () => {
				throw new Error('secret-password Cookie: private-session');
			},
		},
		continueOnFail: () => continueOnFail,
		getNode: () => ({
			id: 'test',
			name: 'Librus',
			type: 'librus',
			typeVersion: 1,
			position: [0, 0],
			parameters: {},
		}),
	};
}
test('Continue On Fail pairs each input and excludes input data and transport secrets', async () => {
	const result = await new Librus().execute.call(context(true));
	assert.equal(result[0].length, 2);
	assert.deepEqual(
		result[0].map((item) => item.pairedItem),
		[{ item: 0 }, { item: 1 }],
	);
	assert.doesNotMatch(JSON.stringify(result), /do-not-copy|secret-password|private-session/);
	assert.equal(result[0][0].json.code, 'TRANSPORT_ERROR');
});
test('normal failure is an n8n error without a raw transport cause', async () => {
	await assert.rejects(new Librus().execute.call(context(false)), (error) => {
		assert.equal(error.name, 'NodeOperationError');
		assert.doesNotMatch(JSON.stringify(error) + error.stack, /secret-password|private-session/);
		return true;
	});
});
test('credential test uses its supported legacy helper and sanitizes errors', async () => {
	const result = await new Librus().methods.credentialTest.librusConnectionTest.call(
		{
			helpers: {
				request: async () => {
					throw new Error('secret-password');
				},
			},
		},
		{ data: { username: 'synthetic', password: 'secret-password' } },
	);
	assert.equal(result.status, 'Error');
	assert.match(result.message, /TRANSPORT_ERROR/);
	assert.doesNotMatch(result.message, /secret-password/);
});

test('Get Content dispatches each input ID and pairs output without reading list-only options', async (t) => {
	const { LibrusClient } = require('../dist/nodes/Librus/LibrusClient');
	const ids = [];
	t.mock.method(LibrusClient.prototype, 'getMessageContent', async (id) => {
		ids.push(id);
		return { messageId: id, content: 'Synthetic full body', contentSource: 'full' };
	});
	const ctx = context(false);
	ctx.getNodeParameter = (name, index) => {
		if (name === 'resource') return 'message';
		if (name === 'operation') return 'getContent';
		if (name === 'messageId') return `synthetic-${index}`;
		throw Error('Unexpected list-only parameter');
	};
	const result = await new Librus().execute.call(ctx);
	assert.deepEqual(ids, ['synthetic-0', 'synthetic-1']);
	assert.deepEqual(
		result[0].map((item) => item.pairedItem),
		[{ item: 0 }, { item: 1 }],
	);
});
test('Get Many passes the selected read filter to the client', async (t) => {
	const { LibrusClient } = require('../dist/nodes/Librus/LibrusClient');
	t.mock.method(LibrusClient.prototype, 'getMessages', async (options) => {
		assert.equal(options.readStatus, 'unread');
		return [];
	});
	const ctx = context(false);
	const parameters = ctx.getNodeParameter;
	ctx.getNodeParameter = (name, index) =>
		name === 'readStatus' ? 'unread' : parameters(name, index);
	assert.deepEqual(await new Librus().execute.call(ctx), [[]]);
});

for (const [name, adapter] of Object.entries({
	modern: createTransport,
	legacy: createCredentialTestTransport,
})) {
	test(`${name} transport normalizes an absent body and excludes request metadata`, async () => {
		const result = await adapter(async () => ({
			statusCode: 302,
			headers: { location: '/next', 'set-cookie': ['state=synthetic; Secure'] },
			body: undefined,
			request: { body: 'synthetic-password', headers: { Cookie: 'private-session' } },
		}))({ url: 'https://api.librus.pl/OAuth/Authorization', method: 'GET' });
		assert.deepEqual(result, {
			statusCode: 302,
			headers: { location: '/next', 'set-cookie': ['state=synthetic; Secure'] },
			body: '',
		});
	});
}

function credentialReplies() {
	const redirect = (location) => ({ statusCode: 302, headers: { location }, body: undefined });
	const ok = (body, headers = {}) => ({ statusCode: 200, headers, body });
	return [
		redirect('https://api.librus.pl/OAuth/Authorization?client_id=46'),
		ok('<form></form>', { 'set-cookie': 'api=synthetic-api; Path=/; Secure' }),
		ok(JSON.stringify({ goTo: '/OAuth/Authorization/2FA' })),
		redirect('https://synergia.librus.pl/rodzic/index'),
		ok(undefined),
		ok('{}'),
		redirect('https://wiadomosci.librus.pl/nowy/inbox'),
		ok(undefined, { 'set-cookie': 'inbox=synthetic-inbox; Path=/; Secure' }),
		ok(JSON.stringify({ data: [] })),
	];
}
async function runCredentialTest(replies) {
	const calls = [];
	const result = await new Librus().methods.credentialTest.librusConnectionTest.call(
		{
			helpers: {
				request: async (options) => {
					calls.push(options);
					assert.ok(replies.length, 'Unexpected additional request');
					return replies.shift();
				},
			},
		},
		{ data: { username: 'synthetic', password: 'synthetic-password' } },
	);
	return { result, calls };
}
test('credential test completes login with legacy empty redirects and empty landing pages', async () => {
	const replies = credentialReplies();
	const { result, calls } = await runCredentialTest(replies);
	assert.equal(result.status, 'OK');
	assert.equal(replies.length, 0);
	assert.equal(calls.length, 9);
	assert.equal(calls[2].headers.Cookie, 'api=synthetic-api');
	assert.equal(calls[8].headers.Cookie, 'inbox=synthetic-inbox');
	assert.doesNotMatch(JSON.stringify(result), /synthetic-password|synthetic-api|synthetic-inbox/);
});
for (const [name, body] of Object.entries({
	missing: undefined,
	object: { data: [] },
	null: null,
})) {
	test(`credential test rejects ${name} body where inbox JSON text is required`, async () => {
		const replies = credentialReplies();
		replies.at(-1).body = body;
		const { result } = await runCredentialTest(replies);
		assert.equal(replies.length, 0);
		assert.equal(result.status, 'Error');
		assert.match(result.message, /PROTOCOL_ERROR/);
	});
}
