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
	'http://evil.example/OAuth/Authorization',
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
test('credential przekierowanie POSTs are never followed or replayed', async () => {
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

test('successful authorization may finish at the powrót OAuth do Synergii', async () => {
	const replies = auth();
	replies[3] = redirect(
		'https://synergia.librus.pl/loguj/portalRodzina?code=synthetic-code&state=synthetic-state',
	);
	const { client, calls } = setup([...replies, ok({ data: [message(1)] })]);
	assert.equal((await client.getMessages(options))[0].messageId, '1');
	assert.ok(calls.some((request) => request.url.endsWith('/Auth/TokenInfo/')));
});

test('an OAuth callback does not bypass the subsequent authenticated access check', async () => {
	const replies = auth();
	replies[3] = redirect('https://synergia.librus.pl/loguj/portalRodzina?code=synthetic-code');
	replies[5] = { statusCode: 401, headers: {}, body: '' };
	const { client, calls } = setup(replies);
	await assert.rejects(client.getMessages(options), { code: 'SESSION_EXPIRED' });
	assert.equal(calls.filter((request) => request.method === 'POST').length, 1);
	assert.ok(!calls.some((request) => request.url.includes('/api/inbox/messages')));
});

test('a login form at the callback still stops, and diagnostics exclude URL secrets', async () => {
	const replies = auth();
	replies[3] = redirect(
		'https://synergia.librus.pl/loguj/portalRodzina?code=private-code&state=private-state',
	);
	replies[4] = ok('<html><form><input name="Login"><input name="Pass"></form></html>');
	await assert.rejects(setup(replies).client.getMessages(options), (error) => {
		assert.equal(error.code, 'ACTION_REQUIRED');
		assert.match(error.message, /Etap: kontynuacja autoryzacji; strona: powrót OAuth do Synergii/);
		assert.doesNotMatch(
			error.stack + JSON.stringify(error),
			/private-code|private-state|synthetic-password/,
		);
		return true;
	});
});

test('legacy HTTP redirects to trusted Librus hosts are upgraded before sending', async () => {
	const replies = auth();
	replies[0] = redirect('http://api.librus.pl/OAuth/Authorization?client_id=46');
	replies[6] = redirect('http://wiadomosci.librus.pl/nowy/inbox');
	const { client, calls } = setup([...replies, ok({ data: [message(1)] })]);
	assert.equal((await client.getMessages(options))[0].messageId, '1');
	assert.ok(calls.every((request) => request.url.startsWith('https://')));
});

test('HTTP redirect upgrade never permits dane logowania w adresie URL or a niestandardowy port', async () => {
	for (const url of [
		'http://user:private-password@api.librus.pl/OAuth/Authorization',
		'http://api.librus.pl:444/OAuth/Authorization',
	]) {
		const { client, calls } = setup([redirect(url)]);
		await assert.rejects(client.getMessages(options), (error) => {
			assert.equal(error.code, 'UNSAFE_URL');
			assert.doesNotMatch(error.message, /private-password/);
			return true;
		});
		assert.equal(calls.length, 1);
	}
});

const fullOptions = { ...options, includeContent: true, contentSource: 'full' };
const detail = (id, body) =>
	ok({ data: { messageId: String(id), Message: Buffer.from(body).toString('base64') } });

test('full content is fetched from message details instead of the truncated listing', async () => {
	const fullBody = '<p>Pełna wiadomość: zażółć gęślą jaźń.</p>'.repeat(40);
	const { client, calls } = setup([...auth(), ok({ data: [message(1)] }), detail(1, fullBody)]);
	const result = await client.getMessages(fullOptions);
	assert.equal(result[0].content, fullBody);
	assert.equal(result[0].contentSource, 'full');
	assert.equal(calls.at(-1).url, 'https://wiadomosci.librus.pl/api/inbox/messages/1');
	assert.equal(calls.filter((r) => r.method === 'POST').length, 1);
});

test('preview remains the default and makes no detail request', async () => {
	const { client, calls } = setup([...auth(), ok({ data: [message(1)] })]);
	const result = await client.getMessages({ ...options, includeContent: true });
	assert.equal(result[0].contentSource, 'preview');
	assert.equal(calls.length, 9);
});

test('full source has no effect when Include Content is disabled', async () => {
	const { client, calls } = setup([...auth(), ok({ data: [message(1)] })]);
	const result = await client.getMessages({ ...fullOptions, includeContent: false });
	assert.equal(result[0].content, undefined);
	assert.equal(result[0].contentSource, undefined);
	assert.equal(calls.length, 9);
});

test('full detail requests run only after pagination, limit and deduplication', async () => {
	const { client, calls } = setup([
		...auth(),
		ok({ data: [message(1), message(1)] }),
		ok({ data: [message(2)] }),
		detail(1, 'First complete message'),
		detail(2, 'Second complete message'),
	]);
	const result = await client.getMessages({ ...fullOptions, limit: 2 });
	assert.deepEqual(
		result.map((m) => m.content),
		['First complete message', 'Second complete message'],
	);
	assert.match(calls[9].url, /messages\?page=2&limit=2$/);
	assert.equal(calls.filter((r) => /messages\/1$/.test(r.url)).length, 1);
});

test('full mode does not depend on the listing preview being valid base64', async () => {
	const { client } = setup([
		...auth(),
		ok({ data: [{ ...message(1), content: 'truncated-invalid-preview' }] }),
		detail(1, 'Complete content'),
	]);
	assert.equal((await client.getMessages(fullOptions))[0].content, 'Complete content');
});

for (const payload of [
	{},
	{ data: null },
	{ data: { messageId: 'another-message', Message: 'eA==' } },
	{ data: { messageId: '1', content: 'eA==' } },
	{ data: { messageId: '1', Message: '!!!!' } },
]) {
	test('invalid or mismatched detail fails without falling back to a misleading preview', async () => {
		await assert.rejects(
			setup([...auth(), ok({ data: [message(1)] }), ok(payload)]).client.getMessages(fullOptions),
			{ code: 'PROTOCOL_ERROR' },
		);
	});
}

test('an incomplete listing never triggers full-content requests', async () => {
	const { client, calls } = setup([
		...auth(),
		ok({ data: Array.from({ length: 50 }, (_, i) => message(i)) }),
	]);
	await assert.rejects(client.getMessages({ ...fullOptions, returnAll: true, maxPages: 1 }), {
		code: 'SCAN_INCOMPLETE',
	});
	assert.equal(calls.length, 9);
});

test('the full-content safety cap fails before fetching any details', async () => {
	const { client, calls } = setup([
		...auth(),
		ok({ data: Array.from({ length: 50 }, (_, i) => message(i)) }),
		ok({ data: [message(50)] }),
	]);
	await assert.rejects(client.getMessages({ ...fullOptions, limit: 51 }), {
		code: 'FULL_CONTENT_LIMIT',
	});
	assert.equal(calls.length, 10);
});

test('a detail failure returns no partial result and does not retry a generic 403', async () => {
	const { client, calls } = setup([
		...auth(),
		ok({ data: [message(1), message(2)] }),
		detail(1, 'Complete first message'),
		{ statusCode: 403, headers: {}, body: 'private body' },
	]);
	await assert.rejects(client.getMessages(fullOptions), { code: 'ACCESS_DENIED' });
	assert.equal(calls.filter((r) => r.method === 'POST').length, 1);
});

test('one recognized detail-session expiry restarts the complete scan', async () => {
	const { client, calls } = setup([
		...auth(),
		ok({ data: [message(1)] }),
		{ statusCode: 401, headers: {}, body: '' },
		...auth(),
		ok({ data: [message(1)] }),
		detail(1, 'Complete after recovery'),
	]);
	assert.equal((await client.getMessages(fullOptions))[0].content, 'Complete after recovery');
	assert.equal(calls.filter((r) => r.method === 'POST').length, 2);
});

test('unsafe message IDs never become detail paths', async () => {
	const { client, calls } = setup([...auth(), ok({ data: [message('../private')] })]);
	await assert.rejects(client.getMessages(fullOptions), { code: 'PROTOCOL_ERROR' });
	assert.equal(calls.length, 9);
});

test('unread filtering skips full read pages, applies Limit to matches and hydrates only selected IDs', async () => {
	const readPage = Array.from({ length: 50 }, (_, i) => ({
		...message(i),
		readDate: '2026-09-01T10:00:00',
	}));
	const { client, calls } = setup([
		...auth(),
		ok({ data: readPage }),
		ok({ data: [message('unread'), message('another')] }),
		ok({ data: { messageId: 'unread', Message: Buffer.from('Full body').toString('base64') } }),
	]);
	const result = await client.getMessages({
		...options,
		limit: 1,
		readStatus: 'unread',
		includeContent: true,
		contentSource: 'full',
	});
	assert.deepEqual(
		result.map((m) => m.messageId),
		['unread'],
	);
	assert.equal(result[0].content, 'Full body');
	assert.match(calls.at(-2).url, /page=2&limit=50$/);
	assert.match(calls.at(-1).url, /messages\/unread$/);
});
test('read filter excludes null and empty read dates; legacy options still return all', async () => {
	const data = [
		message(1),
		{ ...message(2), readDate: '' },
		{ ...message(3), readDate: '2026-09-01' },
	];
	const result = await setup([...auth(), ok({ data })]).client.getMessages({
		...options,
		readStatus: 'read',
	});
	assert.deepEqual(
		result.map((m) => m.messageId),
		['3'],
	);
	assert.equal((await setup([...auth(), ok({ data })]).client.getMessages(options)).length, 3);
});
test('filtered scans still fail at pagination limits and repeated nonmatching pages', async () => {
	const data = Array.from({ length: 50 }, (_, i) => ({ ...message(i), readDate: '2026-09-01' }));
	for (const [replies, maxPages] of [
		[[...auth(), ok({ data })], 1],
		[[...auth(), ok({ data }), ok({ data })], 2],
	]) {
		await assert.rejects(
			setup(replies).client.getMessages({ ...options, readStatus: 'unread', maxPages }),
			{ code: 'SCAN_INCOMPLETE' },
		);
	}
});
test('unsupported read filter and unsafe Get Content IDs fail before any request', async () => {
	await assert.rejects(setup([]).client.getMessages({ ...options, readStatus: 'surprise' }), {
		code: 'INVALID_OPTIONS',
	});
	for (const id of ['', '../1', '1?x=y', undefined])
		await assert.rejects(setup([]).client.getMessageContent(id), { code: 'INVALID_OPTIONS' });
});
test('Get Content uses the exact ID and refreshes an expired session once', async () => {
	const { client, calls } = setup([
		...auth(),
		{ statusCode: 401, headers: {}, body: '' },
		...auth(),
		ok({ data: { messageId: 'abc_123', Message: Buffer.from('Pełna treść').toString('base64') } }),
	]);
	assert.deepEqual(await client.getMessageContent('abc_123'), {
		messageId: 'abc_123',
		content: 'Pełna treść',
		contentSource: 'full',
	});
	assert.equal(calls.filter((c) => c.url.endsWith('/api/inbox/messages/abc_123')).length, 2);
});

test('unread full-content recovery retains selected IDs even if earlier detail reads changed their status', async () => {
	const detail = (id) =>
		ok({ data: { messageId: id, Message: Buffer.from('Body ' + id).toString('base64') } });
	const { client, calls } = setup([
		...auth(),
		ok({ data: [message('a'), message('b')] }),
		detail('a'),
		{ statusCode: 401, headers: {}, body: '' },
		...auth(),
		detail('a'),
		detail('b'),
	]);
	const result = await client.getMessages({
		...options,
		readStatus: 'unread',
		includeContent: true,
		contentSource: 'full',
	});
	assert.deepEqual(
		result.map((m) => m.messageId),
		['a', 'b'],
	);
	assert.deepEqual(
		result.map((m) => m.content),
		['Body a', 'Body b'],
	);
	assert.equal(calls.filter((c) => new URL(c.url).pathname === '/api/inbox/messages').length, 1);
});

// Deliberately invalid synthetic records reproduce the manual/automatic scan difference.
test('manual sample can succeed while a full scan reports the exact invalid metadata field', async () => {
	const first = message('synthetic-first');
	const bad = { ...message('synthetic-private-id'), senderFirstName: null, topic: 'PRIVATE-TOPIC' };
	assert.equal(
		(
			await setup([...auth(), ok({ data: [first] })]).client.getMessages({
				...options,
				limit: 1,
				includeContent: false,
			})
		).length,
		1,
	);
	await assert.rejects(
		setup([...auth(), ok({ data: [first, bad] })]).client.getMessages({
			...options,
			returnAll: true,
			includeContent: false,
		}),
		(error) => {
			assert.equal(error.code, 'PROTOCOL_ERROR');
			assert.match(error.message, /Walidacja: message.senderFirstName; otrzymany typ: null/);
			assert.match(error.message, /Strona skrzynki: 1; rozmiar strony: 50; pozycja: 2/);
			assert.doesNotMatch(
				error.message + error.stack + JSON.stringify(error),
				/synthetic-private-id|PRIVATE-TOPIC|synthetic-password/,
			);
			return true;
		},
	);
});
for (const [field, value, type] of [
	['messageId', 1, 'number'],
	['senderLastName', undefined, 'undefined'],
	['senderName', ['PRIVATE'], 'array'],
	['topic', { secret: 'PRIVATE' }, 'object'],
	['sendDate', false, 'boolean'],
	['readDate', 7, 'number'],
	['category', { secret: 'PRIVATE' }, 'object'],
	['isAnyFileAttached', 1, 'number'],
	['tags', null, 'null'],
	['tags', [{ secret: 'PRIVATE' }], 'object'],
]) {
	test(`metadata diagnostic identifies ${field} of type ${type} without its value`, async () => {
		await assert.rejects(
			setup([
				...auth(),
				ok({ data: [{ ...message('PRIVATE-ID'), [field]: value }] }),
			]).client.getMessages(options),
			(error) => {
				assert.ok(error.message.includes(`Walidacja: message.${field}; otrzymany typ: ${type}`));
				assert.doesNotMatch(error.message + JSON.stringify(error), /PRIVATE|synthetic-password/);
				return true;
			},
		);
	});
}
test('later-page protocol errors identify the page without treating the scan as complete', async () => {
	const firstPage = Array.from({ length: 50 }, (_, i) => message(i));
	await assert.rejects(
		setup([
			...auth(),
			ok({ data: firstPage }),
			ok({ data: { secret: 'PRIVATE' } }),
		]).client.getMessages({
			...options,
			returnAll: true,
		}),
		(error) => {
			assert.match(error.message, /Walidacja: tablica wiadomości; otrzymany typ: object/);
			assert.match(error.message, /Strona skrzynki: 2; rozmiar strony: 50/);
			assert.doesNotMatch(error.message, /PRIVATE|pozycja:/);
			return true;
		},
	);
});
test('non-JSON inbox response has a safe diagnostic instead of copying HTML', async () => {
	await assert.rejects(
		setup([...auth(), ok('<html>PRIVATE-PAGE</html>')]).client.getMessages(options),
		(error) => {
			assert.match(error.message, /Walidacja: HTML zamiast JSON/);
			assert.match(error.message, /Strona skrzynki: 1/);
			assert.doesNotMatch(error.message, /PRIVATE-PAGE/);
			return true;
		},
	);
});
test('protocol errors during authentication are identified without raw response data', async () => {
	await assert.rejects(
		setup([...auth().slice(0, 2), ok('PRIVATE-NOT-JSON')]).client.getMessages(options),
		(error) => {
			assert.match(error.message, /Walidacja: odpowiedź JSON/);
			assert.match(error.message, /Faza: logowanie/);
			assert.doesNotMatch(
				error.message + JSON.stringify(error),
				/PRIVATE-NOT-JSON|synthetic-password/,
			);
			return true;
		},
	);
});

test('Librus tag objects normalize to string IDs without copying unrelated properties', async () => {
	const tags = [
		'legacy-tag',
		{ id: 17, extra: 'PRIVATE-EXTRA' },
		{ id: '0018' },
		{ id: '90071992547409931234' },
	];
	const records = Array.from({ length: 19 }, (_, i) => ({
		...message(i),
		tags: i === 18 ? tags : [],
	}));
	const result = await setup([...auth(), ok({ data: records })]).client.getMessages({
		...options,
		returnAll: true,
		includeContent: true,
	});
	assert.equal(result.length, 19);
	assert.deepEqual(result[18].tags, ['legacy-tag', '17', '0018', '90071992547409931234']);
	assert.deepEqual(result[0].tags, []);
	assert.doesNotMatch(JSON.stringify(result), /PRIVATE-EXTRA/);
});
for (const tag of [
	{},
	{ id: null },
	{ id: '' },
	{ id: true },
	{ id: [] },
	{ id: {} },
	{ id: -1 },
	{ id: 1.5 },
	{ id: Number.MAX_SAFE_INTEGER + 1 },
	null,
	17,
	[],
]) {
	test(`malformed tag remains a protocol error (${JSON.stringify(tag)})`, async () => {
		await assert.rejects(
			setup([...auth(), ok({ data: [{ ...message(1), tags: [tag] }] })]).client.getMessages(
				options,
			),
			(error) => {
				assert.equal(error.code, 'PROTOCOL_ERROR');
				assert.match(error.message, /Walidacja: message.tags/);
				return true;
			},
		);
	});
}

const { parseMonth } = require('../dist/nodes/Librus/terminarz');

const grid = (year, index, rows = {}) => {
	const length = new Date(Date.UTC(year, index, 0)).getUTCDate();
	return Array.from(
		{ length },
		(_, i) =>
			`<div class="kalendarz-dzien"><div class="kalendarz-numer-dnia">${i + 1}</div><table>${
				rows[i + 1] ?? ''
			}</table></div>`,
	).join('');
};
const entryRow = (id, body) =>
	`<tr><td onclick="location.href='/terminarz/szczegoly/${id}'" title="Nauczyciel: Jan Kowalski<br />Opis: Zakres">${body}</td></tr>`;

test('fetches each month with a credential-free POST and returns parsed entries', async () => {
	const { client, calls } = setup([
		...auth(),
		ok(grid(2026, 9, { 18: entryRow(11, 'Matematyka') })),
		ok(grid(2026, 10, {})),
	]);
	const result = await client.getCalendar({ months: ['2026-09', '2026-10'] }, () => []);
	assert.deepEqual(
		result.entries.map((entry) => [entry.key, entry.date]),
		[['szczegoly/11', '2026-09-18']],
	);
	const posts = calls.filter((call) => call.method === 'POST');
	assert.equal(posts.length, 3); // one OAuth login plus two month forms
	assert.equal(posts[1].url, 'https://synergia.librus.pl/terminarz');
	assert.deepEqual(
		[...new URLSearchParams(posts[1].body).entries()],
		[
			['rok', '2026'],
			['miesiac', '9'],
		],
	);
	assert.doesNotMatch(posts[1].body, /synthetic-password/);
});

test('a month form redirected anywhere else is never followed or replayed', async () => {
	const { client, calls } = setup([
		...auth(),
		redirect('https://synergia.librus.pl/terminarz/inny'),
	]);
	await assert.rejects(
		client.getCalendar({ months: ['2026-09'] }, () => []),
		{
			message: /Walidacja: przekierowanie POST/,
		},
	);
	assert.equal(calls.filter((call) => call.url.endsWith('/terminarz/inny')).length, 0);
});

test('a month form redirected to the login page reports an expired session', async () => {
	// getCalendar retries exactly once on SESSION_EXPIRED (matching getMessages), so the
	// second attempt needs its own full authentication cycle before it can fail again.
	const { client } = setup([
		...auth(),
		redirect('https://synergia.librus.pl/loguj'),
		...auth(),
		redirect('https://synergia.librus.pl/loguj'),
	]);
	await assert.rejects(
		client.getCalendar({ months: ['2026-09'] }, () => []),
		{
			message: /Sesja Librusa wygasła/,
		},
	);
});

test('a login form returned instead of the grid reports an expired session', async () => {
	const form = '<form><input name="login" /><input name="pass" type="password" /></form>';
	const { client } = setup([...auth(), ok(form), ...auth(), ok(form)]);
	await assert.rejects(
		client.getCalendar({ months: ['2026-09'] }, () => []),
		{
			message: /Sesja Librusa wygasła/,
		},
	);
});

test('a broken grid fails with the month in the diagnostics and never returns an empty calendar', async () => {
	const { client } = setup([...auth(), ok('<html><body>Awaria</body></html>')]);
	await assert.rejects(
		client.getCalendar({ months: ['2026-09'] }, () => []),
		{
			message: /Walidacja: siatka terminarza.*Miesiąc terminarza: 2026-09/s,
		},
	);
});

test('rejects malformed month windows before touching the network', async () => {
	const { client } = setup([]);
	for (const months of [[], ['2026-9'], ['2026-13'], Array(8).fill('2026-09'), 'no'])
		await assert.rejects(
			client.getCalendar({ months }, () => []),
			{
				message: /Nieprawidłowe dane logowania do Librusa/,
			},
		);
});

const detailPage = (rows) =>
	`<div class="container-background"><table><tbody>${rows
		.map(([label, value]) => `<tr><th>${label}</th><td>${value}</td></tr>`)
		.join('')}</tbody></table></div>`;
const sampleDetail = detailPage([
	['Data', '2026-09-18'],
	['Rodzaj', 'Sprawdzian'],
	['Sala', '12'],
]);

test('hydrates only the selected keys and reports the raw Rodzaj', async () => {
	const { client, calls } = setup([
		...auth(),
		ok(grid(2026, 9, { 18: entryRow(11, 'Matematyka') + entryRow(12, 'Fizyka') })),
		ok(sampleDetail),
	]);
	const result = await client.getCalendar({ months: ['2026-09'] }, () => ['szczegoly/11']);
	assert.equal(result.details.get('szczegoly/11').rodzaj, 'Sprawdzian');
	assert.equal(result.details.has('szczegoly/12'), false);
	assert.equal(calls.at(-1).url, 'https://synergia.librus.pl/terminarz/szczegoly/11');
});

test('a detail page that is gone is left unresolved so the next poll retries it', async () => {
	const { client } = setup([
		...auth(),
		ok(grid(2026, 9, { 18: entryRow(11, 'Matematyka') })),
		{ statusCode: 404, headers: {}, body: 'Nie znaleziono' },
	]);
	const result = await client.getCalendar({ months: ['2026-09'] }, () => ['szczegoly/11']);
	assert.equal(result.details.has('szczegoly/11'), false);
});

test('an entry with no detail link resolves to null so it can still be committed', async () => {
	const row = '<tr><td>Dzień wolny</td></tr>';
	const { client, calls } = setup([...auth(), ok(grid(2026, 9, { 2: row }))]);
	const scanned = await client.getCalendar({ months: ['2026-09'] }, (entries) =>
		entries.map((entry) => entry.key),
	);
	const [key] = [...scanned.details.keys()];
	assert.match(key, /^hash\//);
	assert.equal(scanned.details.get(key), null);
	assert.equal(calls.filter((call) => call.url.includes('/terminarz/szczegoly')).length, 0);
});

test('hydration is bounded, and unhydrated keys stay unresolved', async () => {
	const rows = Object.fromEntries(
		Array.from({ length: 30 }, (_, day) => [
			day + 1,
			entryRow(day + 1, 'Test') + entryRow(day + 101, 'Test'),
		]),
	);
	const { client } = setup([
		...auth(),
		ok(grid(2026, 9, rows)),
		...Array(50).fill(ok(sampleDetail)),
	]);
	const result = await client.getCalendar({ months: ['2026-09'] }, (entries) =>
		entries.map((entry) => entry.key),
	);
	assert.equal(result.details.size, 50);
});

test('link-less entries resolve to null without consuming a detail slot', async () => {
	// 50 link-less rows come first, then three linked ones. A budget that counted the
	// synthetic keys would spend every slot before reaching a single real detail page.
	const rows = Object.fromEntries([
		...Array.from({ length: 25 }, (_, i) => [
			i + 1,
			`<tr><td>Dzień wolny ${i + 1}a</td></tr><tr><td>Dzień wolny ${i + 1}b</td></tr>`,
		]),
		...Array.from({ length: 3 }, (_, i) => [26 + i, entryRow(200 + i, 'Matematyka')]),
	]);
	const { client, calls } = setup([
		...auth(),
		ok(grid(2026, 9, rows)),
		...Array(3).fill(ok(sampleDetail)),
	]);
	const result = await client.getCalendar({ months: ['2026-09'] }, (entries) =>
		entries.map((entry) => entry.key),
	);
	assert.equal(result.details.size, 53);
	assert.equal(calls.filter((call) => call.url.includes('/terminarz/szczegoly/')).length, 3);
	for (const id of [200, 201, 202])
		assert.equal(result.details.get(`szczegoly/${id}`).rodzaj, 'Sprawdzian');
});

test('a session expiry late in hydration leaves the retry a full request budget', async () => {
	// A full window costs about 8 (login) + 7 (months) + 50 (details) requests. On one
	// shared counter the second attempt would run out well before finishing.
	const months = Array.from({ length: 7 }, (_, i) => `2026-0${i + 1}`);
	const rows = Object.fromEntries(
		Array.from({ length: 25 }, (_, i) => [
			i + 1,
			entryRow(i + 1, 'Matematyka') + entryRow(i + 101, 'Fizyka'),
		]),
	);
	const january = () => [
		ok(grid(2026, 1, rows)),
		...months.slice(1).map((month, i) => ok(grid(2026, i + 2, {}))),
	];
	const loginForm = '<form><input name="login" /><input name="pass" type="password" /></form>';
	const { client, calls } = setup([
		...auth(),
		...january(),
		...Array(49).fill(ok(sampleDetail)),
		ok(loginForm), // the 50th detail page comes back as a login form
		...auth(),
		...january(),
		...Array(50).fill(ok(sampleDetail)),
	]);
	const result = await client.getCalendar({ months }, (entries) =>
		entries.map((entry) => entry.key),
	);
	assert.equal(result.details.size, 50);
	assert.equal(calls.length, 130); // both attempts ran to completion: 65 requests each
});

test('an exhausted calendar budget names the month window, not the inbox page limit', async () => {
	const months = Array.from({ length: 7 }, (_, i) => `2026-0${i + 1}`);
	const rows = Object.fromEntries(
		Array.from({ length: 25 }, (_, i) => [
			i + 1,
			entryRow(i + 1, 'Matematyka') + entryRow(i + 101, 'Fizyka'),
		]),
	);
	// Every detail page takes a redirect hop, so hydration costs two requests per entry
	// and the 100-request cap is reached partway through.
	const { client } = setup([
		...auth(),
		ok(grid(2026, 1, rows)),
		...months.slice(1).map((month, i) => ok(grid(2026, i + 2, {}))),
		...Array(50)
			.fill(null)
			.flatMap(() => [
				redirect('https://synergia.librus.pl/terminarz/szczegoly/1'),
				ok(sampleDetail),
			]),
	]);
	await assert.rejects(
		client.getCalendar({ months }, (entries) => entries.map((entry) => entry.key)),
		(error) => {
			assert.equal(error.code, 'CALENDAR_SCAN_INCOMPLETE');
			assert.match(error.message, /Zmniejsz Liczbę miesięcy do przodu/);
			assert.doesNotMatch(error.message, /liczbę stron/i);
			return true;
		},
	);
});

test('an expired session during hydration restarts scan and selection once', async () => {
	let selections = 0;
	const { client } = setup([
		...auth(),
		ok(grid(2026, 9, { 18: entryRow(11, 'Matematyka') })),
		redirect('https://synergia.librus.pl/loguj'),
		// The detail request is a GET, so `request()` follows this redirect itself
		// (only a POST redirect to /loguj short-circuits without following). The next
		// reply is what the follow lands on: a terminal login-page response at /loguj.
		ok('<form><input name="login" /><input name="pass" type="password" /></form>'),
		...auth(),
		ok(grid(2026, 9, { 18: entryRow(11, 'Matematyka') })),
		ok(sampleDetail),
	]);
	const result = await client.getCalendar({ months: ['2026-09'] }, () => {
		selections += 1;
		return ['szczegoly/11'];
	});
	assert.equal(selections, 2);
	assert.equal(result.details.get('szczegoly/11').rodzaj, 'Sprawdzian');
});
