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
	for (const icon of Object.values(node.description.icon))
		assert.ok(fs.existsSync(`dist/nodes/Librus/${icon.slice(5)}`));
});
test('both transport adapters disable automatic redirects and preserve raw response', async () => {
	const request = {
		url: 'https://api.librus.pl/OAuth/Authorization',
		method: 'POST',
		headers: {},
		body: 'synthetic',
		timeout: 1000,
	};
	const response = { statusCode: 302, headers: { location: '/next' }, body: '' };
	let modern, legacy;
	assert.equal(
		await createTransport(async (options) => {
			modern = options;
			return response;
		})(request),
		response,
	);
	assert.equal(
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
