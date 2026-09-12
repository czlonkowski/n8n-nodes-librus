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
			/Zapisana historia|limit historii/,
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
		assert.match(error.message, /Walidacja: message.senderFirstName; otrzymany typ: null/);
		assert.match(error.message, /Strona skrzynki: 2; rozmiar strony: 50; pozycja: 1/);
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

const { monthWindow } = require('../dist/nodes/Librus/calendarState');

function calendarContext(state, event, overrides = {}, manual = false) {
	const parameters = { event, monthsAhead: 1, eventTypes: '', ...overrides };
	return {
		...context(state, manual),
		getNodeParameter: (name) => parameters[name],
		getMode: () => (manual ? 'manual' : 'trigger'),
		getWorkflowStaticData: () => state,
	};
}
const calendarEntry = (key, date, text = 'Matematyka') => ({
	key,
	route: key.startsWith('hash/') ? null : key.split('/')[0],
	eventId: key.startsWith('hash/') ? null : key.split('/')[1],
	date,
	subject: text,
	teacher: 'Jan Kowalski',
	description: 'Zakres',
	lessonNumber: 3,
	hour: '10:45',
	text,
});
const calendarDetail = (rodzaj) => ({
	fields: { Rodzaj: rodzaj, Sala: '12' },
	rodzaj,
	room: '12',
	addedAt: '2026-09-01 12:03:00',
	teacher: 'Jan Kowalski',
	subject: 'Matematyka',
	description: 'Zakres',
	lessonNumber: 3,
	date: '2026-09-18',
});
/** Replaces the network by driving getCalendar's selector with fixed entries. */
function stubCalendar(entries, details) {
	const original = LibrusClient.prototype.getCalendar;
	LibrusClient.prototype.getCalendar = async function (options, select) {
		select(entries);
		return { entries, details };
	};
	return () => {
		LibrusClient.prototype.getCalendar = original;
	};
}

test('the node registers three events and keeps newMessage as the default', () => {
	const trigger = new LibrusTrigger();
	const event = trigger.description.properties.find((property) => property.name === 'event');
	assert.equal(event.default, 'newMessage');
	assert.deepEqual(
		event.options.map((option) => option.value),
		['newMessage', 'newCalendarEvent', 'changedCalendarEvent'],
	);
	const calendarOnly = trigger.description.properties.filter(
		(property) => property.name === 'monthsAhead' || property.name === 'eventTypes',
	);
	assert.equal(calendarOnly.length, 2);
	for (const property of calendarOnly)
		assert.deepEqual(property.displayOptions.show.event, [
			'newCalendarEvent',
			'changedCalendarEvent',
		]);
});

test('the first calendar poll is a silent baseline and the next one emits additions only', async () => {
	const state = {};
	const trigger = new LibrusTrigger();
	let restore = stubCalendar([calendarEntry('szczegoly/1', '2026-09-18')], new Map());
	try {
		assert.equal(await trigger.poll.call(calendarContext(state, 'newCalendarEvent')), null);
	} finally {
		restore();
	}
	restore = stubCalendar(
		[calendarEntry('szczegoly/1', '2026-09-18'), calendarEntry('szczegoly/2', '2026-09-20')],
		new Map([['szczegoly/2', calendarDetail('Kartkówka')]]),
	);
	let result;
	try {
		result = await trigger.poll.call(calendarContext(state, 'newCalendarEvent'));
	} finally {
		restore();
	}
	assert.equal(result[0].length, 1);
	assert.deepEqual(
		{
			changeType: result[0][0].json.changeType,
			eventKey: result[0][0].json.eventKey,
			rodzaj: result[0][0].json.rodzaj,
			room: result[0][0].json.room,
			details: result[0][0].json.details,
		},
		{
			changeType: 'new',
			eventKey: 'szczegoly/2',
			rodzaj: 'Kartkówka',
			room: '12',
			details: { Rodzaj: 'Kartkówka', Sala: '12' },
		},
	);
});

test('the change event emits edits and disappearances, and never additions', async () => {
	const state = {};
	const trigger = new LibrusTrigger();
	let restore = stubCalendar(
		[calendarEntry('szczegoly/1', '2026-09-18'), calendarEntry('szczegoly/2', '2026-09-20')],
		new Map(),
	);
	try {
		await trigger.poll.call(calendarContext(state, 'changedCalendarEvent'));
	} finally {
		restore();
	}
	restore = stubCalendar(
		[calendarEntry('szczegoly/1', '2026-09-25'), calendarEntry('szczegoly/3', '2026-09-27')],
		new Map([
			['szczegoly/1', calendarDetail('Sprawdzian')],
			['szczegoly/3', calendarDetail('Wycieczka')],
		]),
	);
	let result;
	try {
		result = await trigger.poll.call(calendarContext(state, 'changedCalendarEvent'));
	} finally {
		restore();
	}
	assert.deepEqual(
		result[0].map((item) => [item.json.changeType, item.json.eventKey]).sort(),
		[
			['changed', 'szczegoly/1'],
			['removed', 'szczegoly/2'],
		].sort(),
	);
});

test('the type filter matches case-insensitively and never drops an unknown kind', async () => {
	const state = {};
	const trigger = new LibrusTrigger();
	let restore = stubCalendar([], new Map());
	try {
		await trigger.poll.call(calendarContext(state, 'newCalendarEvent'));
	} finally {
		restore();
	}
	restore = stubCalendar(
		[
			calendarEntry('szczegoly/1', '2026-09-18'),
			calendarEntry('szczegoly/2', '2026-09-19'),
			calendarEntry('szczegoly/3', '2026-09-20'),
		],
		new Map([
			['szczegoly/1', calendarDetail('Sprawdzian')],
			['szczegoly/2', calendarDetail('Wycieczka')],
			['szczegoly/3', null],
		]),
	);
	let result;
	try {
		result = await trigger.poll.call(
			calendarContext(state, 'newCalendarEvent', { eventTypes: ' SPRAWDZIAN , kartkówka ' }),
		);
	} finally {
		restore();
	}
	assert.deepEqual(result[0].map((item) => item.json.eventKey).sort(), [
		'szczegoly/1',
		'szczegoly/3',
	]);
});

test('a manual test returns a bounded sample and never touches history', async () => {
	const state = {};
	const trigger = new LibrusTrigger();
	const entries = Array.from({ length: 9 }, (_, i) =>
		calendarEntry(`szczegoly/${i}`, '2026-09-18'),
	);
	const restore = stubCalendar(entries, new Map());
	let result;
	try {
		result = await trigger.poll.call(calendarContext(state, 'newCalendarEvent', {}, true));
	} finally {
		restore();
	}
	assert.equal(result[0].length, 5);
	assert.equal(result[0][0].json.changeType, 'sample');
	assert.deepEqual(state, {});
});

test('a credential change re-baselines the calendar instead of going silent forever', async () => {
	const other = accountKey('other-login', 'credential-2');
	const asAccount = (state, username, credentialId) => {
		const base = calendarContext(state, 'newCalendarEvent');
		return {
			...base,
			getCredentials: async () => ({ username, password: 'secret-password' }),
			getNode: () => ({
				...base.getNode(),
				credentials: { librusSessionApi: { id: credentialId, name: 'Librus' } },
			}),
		};
	};
	const trigger = new LibrusTrigger();
	const state = {};
	let restore = stubCalendar([calendarEntry('szczegoly/1', '2026-09-18')], new Map());
	try {
		assert.equal(
			await trigger.poll.call(asAccount(state, 'synthetic-login', 'credential-1')),
			null,
		);
	} finally {
		restore();
	}
	assert.equal(state.librusCalendar.account, account);
	restore = stubCalendar(
		[calendarEntry('szczegoly/2', '2026-09-19')],
		new Map([['szczegoly/2', calendarDetail('Sprawdzian')]]),
	);
	try {
		// The switch itself emits nothing, but it must commit: the old code aborted here
		// and then aborted on every later poll, forever and without a word.
		assert.equal(await trigger.poll.call(asAccount(state, 'other-login', 'credential-2')), null);
	} finally {
		restore();
	}
	assert.equal(state.librusCalendar.account, other);
	assert.deepEqual(Object.keys(state.librusCalendar.events), ['szczegoly/2']);
	restore = stubCalendar(
		[calendarEntry('szczegoly/2', '2026-09-19'), calendarEntry('szczegoly/3', '2026-09-20')],
		new Map([['szczegoly/3', calendarDetail('Wycieczka')]]),
	);
	let result;
	try {
		result = await trigger.poll.call(asAccount(state, 'other-login', 'credential-2'));
	} finally {
		restore();
	}
	assert.deepEqual(
		result[0].map((item) => [item.json.changeType, item.json.eventKey]),
		[['new', 'szczegoly/3']],
	);
});

test('the message event keeps its existing behaviour and its own state key', async () => {
	const state = {
		librusCalendar: {
			version: 1,
			rev: 3,
			account,
			window: { from: '2026-09', monthsAhead: 1 },
			events: {},
		},
	};
	assert.deepEqual(selectNewMessages(state, account, [message('a')]), []);
	assert.equal(state.librus.seenIds.length, 1);
	assert.equal(state.librusCalendar.rev, 3);
});
