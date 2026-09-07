const { test } = require('node:test');
const assert = require('node:assert/strict');
const { LibrusClient } = require('../dist/nodes/Librus/LibrusClient');

const login = { username: 'synthetic-login', password: 'synthetic-password&=?' };
const options = { returnAll: false, limit: 50, maxPages: 20, includeContent: false };
const ok = (body = '', headers = {}) => ({
	statusCode: 200,
	headers,
	body: typeof body === 'string' ? body : JSON.stringify(body),
});
const redirect = (location, headers = {}) => ({
	statusCode: 302,
	headers: { location, ...headers },
	body: '',
});
const message = (id) => ({
	messageId: String(id),
	senderFirstName: 'Jan',
	senderLastName: 'Testowy',
	senderName: 'Jan Testowy',
	topic: 'Synthetic topic',
	content: Buffer.from('Zażółć <b>gęślą</b>').toString('base64'),
	sendDate: '2026-09-07 09:00:00',
	readDate: null,
	isAnyFileAttached: false,
	tags: [],
	category: null,
});
function auth() {
	return [
		redirect('https://api.librus.pl/OAuth/Authorization?client_id=46', {
			'set-cookie': 'state=synthetic-state; Path=/; Secure; HttpOnly',
		}),
		ok('<form></form>', {
			'set-cookie': [
				'api=synthetic-api; Path=/; Secure',
				'other=two; Expires=Wed, 09 Jun 2038 10:18:14 GMT; Path=/; Secure',
			],
		}),
		ok({ goTo: '/OAuth/Authorization/2FA' }),
		redirect('https://synergia.librus.pl/rodzic/index'),
		ok('', { 'set-cookie': 'session=synthetic-session; Path=/; Secure; HttpOnly' }),
		ok({}),
		redirect('https://wiadomosci.librus.pl/nowy/inbox'),
		ok('', { 'set-cookie': 'inbox=synthetic-inbox; Path=/; Secure; HttpOnly' }),
	];
}
function setup(replies) {
	const calls = [];
	const client = new LibrusClient(async (request) => {
		calls.push(request);
		assert.ok(replies.length, 'Unexpected additional request');
		const reply = replies.shift();
		if (reply instanceof Error) throw reply;
		return reply;
	}, login);
	return { client, calls, replies };
}
test('login, host-scoped cookies, exact string IDs and metadata-only output', async () => {
	const { client, calls, replies } = setup([
		...auth(),
		ok({ data: [message('90071992547409931234')] }),
	]);
	const result = await client.getMessages(options);
	assert.equal(result[0].messageId, '90071992547409931234');
	assert.equal(result[0].content, undefined);
	assert.equal(result[0].readDate, null);
	assert.equal(result[0].sendDate, '2026-09-07 09:00:00');
	assert.equal(new URLSearchParams(calls[2].body).get('pass'), login.password);
	assert.match(calls[2].headers.Cookie, /api=synthetic-api/);
	assert.doesNotMatch(calls[2].headers.Cookie, /state=/);
	assert.match(calls[4].headers.Cookie, /state=/);
	assert.equal(calls[8].headers.Cookie, 'inbox=synthetic-inbox');
	assert.equal(calls.filter((call) => call.method === 'POST').length, 1);
	assert.equal(replies.length, 0);
});
test('content is explicitly decoded as UTF-8 without stripping HTML', async () => {
	const { client } = setup([...auth(), ok({ data: [message(1)] })]);
	assert.equal(
		(await client.getMessages({ ...options, includeContent: true }))[0].content,
		'Zażółć <b>gęślą</b>',
	);
});
test('paginates at a stable size and deduplicates overlapping IDs', async () => {
	const first = Array.from({ length: 50 }, (_, i) => message(i));
	const { client, calls } = setup([
		...auth(),
		ok({ data: first }),
		ok({ data: [message(49), message(50)] }),
	]);
	const result = await client.getMessages({ ...options, returnAll: true });
	assert.equal(result.length, 51);
	assert.match(calls.at(-1).url, /page=2&limit=50$/);
});
test('a full final page and a repeated page fail instead of silently truncating', async () => {
	const page = Array.from({ length: 50 }, (_, i) => message(i));
	await assert.rejects(
		setup([...auth(), ok({ data: page })]).client.getMessages({
			...options,
			returnAll: true,
			maxPages: 1,
		}),
		{ code: 'SCAN_INCOMPLETE' },
	);
	await assert.rejects(
		setup([...auth(), ok({ data: page }), ok({ data: page })]).client.getMessages({
			...options,
			returnAll: true,
		}),
		{ code: 'SCAN_INCOMPLETE' },
	);
});
test('bounded limit returns exactly the requested unique count', async () => {
	const { client } = setup([
		...auth(),
		ok({ data: Array.from({ length: 50 }, (_, i) => message(i)) }),
		ok({ data: [message(50), message(51)] }),
	]);
	assert.equal((await client.getMessages({ ...options, limit: 51 })).length, 51);
});
test('an expired authenticated session is retried once and scanning starts over', async () => {
	const expired = { statusCode: 401, headers: {}, body: '' };
	const { client, calls } = setup([...auth(), expired, ...auth(), ok({ data: [message(2)] })]);
	assert.equal((await client.getMessages(options))[0].messageId, '2');
	assert.equal(calls.filter((r) => r.method === 'POST').length, 2);
	await assert.rejects(
		setup([...auth(), expired, ...auth(), expired]).client.getMessages(options),
		{ code: 'SESSION_EXPIRED' },
	);
});
for (const [statusCode, code] of [
	[403, 'ACCESS_DENIED'],
	[429, 'RATE_LIMITED'],
	[500, 'SERVICE_ERROR'],
]) {
	test(`HTTP ${statusCode} does not trigger a new login`, async () => {
		const { client, calls } = setup([
			...auth(),
			{ statusCode, headers: {}, body: 'private response' },
		]);
		await assert.rejects(client.getMessages(options), { code });
		assert.equal(calls.filter((r) => r.method === 'POST').length, 1);
	});
}
test('wrong credentials stop before any retry', async () => {
	const { client, calls } = setup([...auth().slice(0, 2), ok({ error: 'private details' })]);
	await assert.rejects(client.getMessages(options), { code: 'AUTH_FAILED' });
	assert.equal(calls.length, 3);
});
test('challenge page produces an action-required error', async () => {
	await assert.rejects(
		setup([...auth().slice(0, 3), ok('<form>verification</form>')]).client.getMessages(options),
		{ code: 'ACTION_REQUIRED' },
	);
});
for (const url of [
	'https://evil.example/steal',
	'http://api.librus.pl/OAuth/Authorization',
	'https://api.librus.pl:444/OAuth/Authorization',
	'https://name:secret@api.librus.pl/OAuth/Authorization',
	'https://api.librus.pl.evil.example/',
]) {
	test(`rejects redirect to ${url}`, async () => {
		const { client, calls } = setup([redirect(url)]);
		await assert.rejects(client.getMessages(options), { code: 'UNSAFE_URL' });
		assert.equal(calls.length, 1);
	});
}
test('credential POST redirects are never followed or replayed', async () => {
	const { client, calls } = setup([
		...auth().slice(0, 2),
		redirect('https://synergia.librus.pl/steal'),
	]);
	await assert.rejects(client.getMessages(options), { code: 'PROTOCOL_ERROR' });
	assert.equal(calls.length, 3);
});
test('untrusted goTo is rejected before requesting it', async () => {
	await assert.rejects(
		setup([
			...auth().slice(0, 2),
			ok({ goTo: 'https://wiadomosci.librus.pl/steal' }),
		]).client.getMessages(options),
		{ code: 'UNSAFE_URL' },
	);
});
for (const payload of [
	{},
	{ data: null },
	{ data: [{ ...message(1), messageId: 123 }] },
	'<html>login</html>',
]) {
	test('malformed listing fails, rather than looking like an empty inbox', async () => {
		await assert.rejects(setup([...auth(), ok(payload)]).client.getMessages(options), {
			code: 'PROTOCOL_ERROR',
		});
	});
}
test('malformed base64 and UTF-8 fail when content is requested', async () => {
	for (const content of ['!!!!', '/w==']) {
		await assert.rejects(
			setup([...auth(), ok({ data: [{ ...message(1), content }] })]).client.getMessages({
				...options,
				includeContent: true,
			}),
			{ code: 'PROTOCOL_ERROR' },
		);
	}
});
test('transport exception does not leak request, credential or response details', async () => {
	const { client } = setup([
		new Error(JSON.stringify(login) + ' Cookie: secret-session private-message'),
	]);
	await assert.rejects(client.getMessages(options), (error) => {
		assert.equal(error.code, 'TRANSPORT_ERROR');
		assert.doesNotMatch(
			error.stack + JSON.stringify(error),
			/synthetic-password|secret-session|private-message|synthetic-login/,
		);
		return true;
	});
});
test('invalid options perform no network calls', async () => {
	const { client, calls } = setup([]);
	await assert.rejects(client.getMessages({ ...options, maxPages: 0 }), {
		code: 'INVALID_OPTIONS',
	});
	assert.equal(calls.length, 0);
});

test('omitted nullable fields normalize to null', async () => {
	const entry = message(1);
	delete entry.readDate;
	delete entry.category;
	const result = await setup([...auth(), ok({ data: [entry] })]).client.getMessages(options);
	assert.equal(result[0].readDate, null);
	assert.equal(result[0].category, null);
});
for (const statusCode of [200, 403]) {
	test(`a recognizable HTML login form with HTTP ${statusCode} permits one fresh session`, async () => {
		const body =
			'<html><form><input name="login"><input name="pass" type="password"></form></html>';
		const { client, calls } = setup([
			...auth(),
			{ statusCode, headers: {}, body },
			...auth(),
			ok({ data: [] }),
		]);
		assert.deepEqual(await client.getMessages(options), []);
		assert.equal(calls.filter((r) => r.method === 'POST').length, 2);
	});
}
test('HTML challenge immediately after password submission requires user action', async () => {
	await assert.rejects(
		setup([
			...auth().slice(0, 2),
			ok('<html><form>Verification needed</form></html>'),
		]).client.getMessages(options),
		{ code: 'ACTION_REQUIRED' },
	);
});
test('a deadline reached during cookie preparation never sends a zero-timeout request', async () => {
	const originalNow = Date.now;
	let calls = 0;
	Date.now = () => (++calls < 3 ? 1000 : 121001);
	try {
		const instance = setup([]);
		await assert.rejects(instance.client.getMessages(options), { code: 'SCAN_INCOMPLETE' });
		assert.equal(instance.calls.length, 0);
	} finally {
		Date.now = originalNow;
	}
});
