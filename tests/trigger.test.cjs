const { test } = require('node:test');
const assert = require('node:assert/strict');
const { LibrusTrigger } = require('../dist/nodes/Librus/LibrusTrigger.node');
const { LibrusClient, LibrusError } = require('../dist/nodes/Librus/LibrusClient');
const { accountKey, selectNewMessages } = require('../dist/nodes/Librus/pollState');
const message = (id, readDate = null) => ({
	messageId: id,
	readDate,
	topic: 'Synthetic',
	content: 'Preview',
});
const account = accountKey('synthetic-login', 'credential-1');
function context(state, manual = false) {
	return {
		getNodeParameter: (name) => ({ event: 'newMessage', maxPages: 20, includePreview: true })[name],
		getCredentials: async () => ({ username: 'synthetic-login', password: 'secret-password' }),
		getMode: () => (manual ? 'manual' : 'trigger'),
		getWorkflowStaticData: () => state,
		getNode: () => ({
			id: 'trigger',
			name: 'Librus Trigger',
			type: 'librusTrigger',
			typeVersion: 1,
			position: [0, 0],
			parameters: {},
			credentials: { librusSessionApi: { id: 'credential-1', name: 'Librus' } },
		}),
		helpers: {
			httpRequest: async () => {
				throw Error('Unexpected network request');
			},
		},
	};
}
test('trigger registers as a polling source and shares a working credential-test method', () => {
	const trigger = new LibrusTrigger();
	assert.equal(trigger.description.polling, true);
	assert.deepEqual(trigger.description.inputs, []);
	assert.equal(
		typeof trigger.methods.credentialTest[trigger.description.credentials[0].testedBy],
		'function',
	);
	assert.ok(
		require('../package.json').n8n.nodes.includes('dist/nodes/Librus/LibrusTrigger.node.js'),
	);
});
test('baseline, restart, read-status changes and restored old IDs never replay', () => {
	const state = {};
	assert.deepEqual(
		selectNewMessages(state, account, [message('old'), message('read', 'date')]),
		[],
	);
	const restored = JSON.parse(JSON.stringify(state));
	assert.deepEqual(selectNewMessages(restored, account, []), []);
	assert.deepEqual(
		selectNewMessages(restored, account, [message('old', 'date'), message('read')]),
		[],
	);
	assert.deepEqual(
		selectNewMessages(restored, account, [message('new', 'date'), message('new')]).map(
			(m) => m.messageId,
		),
		['new'],
	);
	assert.deepEqual(selectNewMessages(restored, account, [message('new')]), []);
	assert.doesNotMatch(
		JSON.stringify(restored),
		/synthetic-login|secret-password|Synthetic|Preview/,
	);
});
test('switching accounts establishes a separate silent baseline', () => {
	const state = {};
	selectNewMessages(state, account, [message('1')]);
	assert.deepEqual(
		selectNewMessages(state, accountKey('other', 'credential-1'), [message('2')]),
		[],
	);
	assert.deepEqual(state.librus.seenIds, ['2']);
});
test('state corruption and capacity exhaustion leave history unchanged', () => {
	for (const state of [
		{ librus: { version: 99 } },
		{
			librus: { version: 1, account, seenIds: Array.from({ length: 10000 }, (_, i) => String(i)) },
		},
	]) {
		const before = JSON.stringify(state);
		assert.throws(
			() => selectNewMessages(state, account, [message('new')]),
			/saved Librus trigger state|history limit/,
		);
		assert.equal(JSON.stringify(state), before);
	}
});
test('manual polling returns a single sample without even accessing persistent state', async (t) => {
	let scan;
	t.mock.method(LibrusClient.prototype, 'getMessages', async (options) => {
		scan = options;
		return [message('sample')];
	});
	const ctx = context({}, true);
	ctx.getWorkflowStaticData = () => {
		throw Error('Must not touch history');
	};
	const result = await new LibrusTrigger().poll.call(ctx);
	assert.equal(result[0][0].json.messageId, 'sample');
	assert.equal(scan.returnAll, false);
	assert.equal(scan.limit, 1);
	assert.equal(scan.contentSource, 'preview');
});
test('automatic polling scans all statuses, baselines silently, then emits new messages only', async (t) => {
	const state = {};
	let inbox = [message('existing')];
	t.mock.method(LibrusClient.prototype, 'getMessages', async (options) => {
		assert.equal(options.returnAll, true);
		assert.equal(options.readStatus, undefined);
		assert.equal(options.contentSource, 'preview');
		return inbox;
	});
	const trigger = new LibrusTrigger();
	const ctx = context(state);
	assert.equal(await trigger.poll.call(ctx), null);
	inbox = [message('new'), message('existing')];
	assert.deepEqual(
		(await trigger.poll.call(ctx))[0].map((m) => m.json.messageId),
		['new'],
	);
	// Downstream work happens after poll returns; a failed consumer does not rewind its cursor.
	assert.equal(await trigger.poll.call(ctx), null);
});
test('scan failures preserve state and never disclose raw transport data', async (t) => {
	for (const error of [
		new LibrusError('SCAN_INCOMPLETE'),
		new LibrusError('AUTH_FAILED'),
		Error('secret-password private-cookie'),
	]) {
		const state = {};
		selectNewMessages(state, account, [message('existing')]);
		const before = JSON.stringify(state);
		const mock = t.mock.method(LibrusClient.prototype, 'getMessages', async () => {
			throw error;
		});
		await assert.rejects(new LibrusTrigger().poll.call(context(state)), (err) => {
			assert.equal(err.name, 'NodeOperationError');
			assert.doesNotMatch(err.message + err.stack, /secret-password|private-cookie/);
			return true;
		});
		mock.mock.restore();
		assert.equal(JSON.stringify(state), before);
	}
});
test('empty manual inbox returns no sample and leaves state unchanged', async (t) => {
	t.mock.method(LibrusClient.prototype, 'getMessages', async () => []);
	const state = {};
	assert.equal(await new LibrusTrigger().poll.call(context(state, true)), null);
	assert.deepEqual(state, {});
});
test('overlapping polls sharing one state compare only after the scan completes', async (t) => {
	const state = {};
	selectNewMessages(state, account, []);
	const resolvers = [];
	t.mock.method(
		LibrusClient.prototype,
		'getMessages',
		() => new Promise((resolve) => resolvers.push(resolve)),
	);
	const trigger = new LibrusTrigger();
	const first = trigger.poll.call(context(state));
	const second = trigger.poll.call(context(state));
	await new Promise((resolve) => setImmediate(resolve));
	resolvers[1]([message('new')]);
	assert.equal((await second)[0].length, 1);
	resolvers[0]([message('new')]);
	assert.equal(await first, null);
});
test('independent stale state copies can emit duplicates: no distributed exactly-once promise', () => {
	const state = {};
	selectNewMessages(state, account, []);
	const copy = JSON.parse(JSON.stringify(state));
	assert.equal(selectNewMessages(state, account, [message('new')]).length, 1);
	assert.equal(selectNewMessages(copy, account, [message('new')]).length, 1);
});

test('activation preserves history and surfaces safe diagnostics for invalid later-page metadata', async () => {
	const raw = (id) => ({
		messageId: String(id),
		senderFirstName: 'Synthetic',
		senderLastName: 'Sender',
		senderName: 'Synthetic Sender',
		topic: 'PRIVATE-TOPIC',
		sendDate: '2026-09-08',
		readDate: null,
		category: null,
		isAnyFileAttached: false,
		tags: [],
	});
	const ok = (body = '') => ({
		statusCode: 200,
		headers: {},
		body: typeof body === 'string' ? body : JSON.stringify(body),
	});
	const redirect = (location) => ({ statusCode: 302, headers: { location }, body: '' });
	const replies = [
		redirect('https://api.librus.pl/OAuth/Authorization?client_id=46'),
		ok('<form></form>'),
		ok({ goTo: '/OAuth/Authorization/2FA' }),
		redirect('https://synergia.librus.pl/rodzic/index'),
		ok(),
		ok('{}'),
		redirect('https://wiadomosci.librus.pl/nowy/inbox'),
		ok(),
		ok({ data: Array.from({ length: 50 }, (_, i) => raw(i)) }),
		ok({ data: [{ ...raw('PRIVATE-ID'), senderFirstName: null }] }),
	];
	const state = {};
	selectNewMessages(state, account, [message('existing')]);
	const before = JSON.stringify(state);
	const ctx = context(state);
	const parameters = ctx.getNodeParameter;
	ctx.getNodeParameter = (name) => (name === 'includePreview' ? false : parameters(name));
	ctx.helpers.httpRequest = async () => {
		assert.ok(replies.length, 'Unexpected request');
		return replies.shift();
	};
	await assert.rejects(new LibrusTrigger().poll.call(ctx), (error) => {
		assert.match(error.message, /Check: message.senderFirstName; received type: null/);
		assert.match(error.message, /Inbox page: 2; page size: 50; item: 1/);
		assert.doesNotMatch(
			error.message + error.stack + JSON.stringify(error),
			/PRIVATE-ID|PRIVATE-TOPIC|secret-password|synthetic-login/,
		);
		return true;
	});
	assert.equal(replies.length, 0);
	assert.equal(JSON.stringify(state), before);
});

test('automatic polling baselines a tagged 19th message and emits a new tagged message once', async () => {
	const raw = (id, tags = []) => ({
		messageId: String(id),
		senderFirstName: 'Synthetic',
		senderLastName: 'Sender',
		senderName: 'Synthetic Sender',
		topic: 'Synthetic',
		sendDate: '2026-09-08',
		readDate: null,
		category: null,
		isAnyFileAttached: false,
		tags,
	});
	let inbox = Array.from({ length: 19 }, (_, i) => raw(i, i === 18 ? [{ id: 17 }] : []));
	const ok = (body = '') => ({
		statusCode: 200,
		headers: {},
		body: typeof body === 'string' ? body : JSON.stringify(body),
	});
	const redirect = (location) => ({ statusCode: 302, headers: { location }, body: '' });
	const replies = () => [
		redirect('https://api.librus.pl/OAuth/Authorization?client_id=46'),
		ok('<form></form>'),
		ok({ goTo: '/OAuth/Authorization/2FA' }),
		redirect('https://synergia.librus.pl/rodzic/index'),
		ok(),
		ok('{}'),
		redirect('https://wiadomosci.librus.pl/nowy/inbox'),
		ok(),
		ok({ data: inbox }),
	];
	let pending = replies();
	const state = {};
	const ctx = context(state);
	const parameters = ctx.getNodeParameter;
	ctx.getNodeParameter = (name) => (name === 'includePreview' ? false : parameters(name));
	ctx.helpers.httpRequest = async () => {
		assert.ok(pending.length, 'Unexpected request');
		return pending.shift();
	};
	const trigger = new LibrusTrigger();
	assert.equal(await trigger.poll.call(ctx), null);
	assert.equal(pending.length, 0);
	assert.equal(state.librus.seenIds.length, 19);
	inbox = [raw('new', [{ id: '0021', extra: 'PRIVATE-EXTRA' }]), ...inbox];
	pending = replies();
	const result = await trigger.poll.call(ctx);
	assert.equal(result[0].length, 1);
	assert.equal(result[0][0].json.messageId, 'new');
	assert.deepEqual(result[0][0].json.tags, ['0021']);
	assert.doesNotMatch(JSON.stringify(result), /PRIVATE-EXTRA/);
	pending = replies();
	assert.equal(await trigger.poll.call(ctx), null);
	assert.equal(pending.length, 0);
});
