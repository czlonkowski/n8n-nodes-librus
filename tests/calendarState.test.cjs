const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
	monthWindow,
	fingerprint,
	planCalendarPoll,
	MAX_HYDRATION,
} = require('../dist/nodes/Librus/calendarState');
const { accountKey } = require('../dist/nodes/Librus/pollState');

const account = accountKey('synthetic-login', 'credential-1');
const entry = (key, date, text = 'Matematyka') => ({
	key,
	route: key.startsWith('hash/') ? null : key.split('/')[0],
	eventId: key.startsWith('hash/') ? null : key.split('/')[1],
	date,
	subject: text.split('\n')[0],
	teacher: 'Jan Kowalski',
	description: 'Zakres',
	lessonNumber: 3,
	hour: '10:45',
	text,
});
const window = (from, monthsAhead, months) => ({ from, monthsAhead, months });

test('builds an inclusive month window and rejects impossible spans', () => {
	assert.deepEqual(monthWindow(new Date(2026, 10, 15), 2), {
		from: '2026-11',
		monthsAhead: 2,
		months: ['2026-11', '2026-12', '2027-01'],
	});
	assert.deepEqual(monthWindow(new Date(2026, 8, 1), 0).months, ['2026-09']);
	for (const invalid of [-1, 7, 1.5, '2'])
		assert.throws(() => monthWindow(new Date(2026, 8, 1), invalid), {
			message: /Nieprawidłowe dane logowania do Librusa/,
		});
});

test('the fingerprint tracks date, text, teacher and description, not derived fields', () => {
	const base = entry('szczegoly/1', '2026-09-18');
	assert.equal(fingerprint(base), fingerprint({ ...base, lessonNumber: 9, hour: '08:00' }));
	assert.notEqual(fingerprint(base), fingerprint({ ...base, date: '2026-09-19' }));
	assert.notEqual(fingerprint(base), fingerprint({ ...base, description: 'Inny' }));
	assert.notEqual(fingerprint(base), fingerprint({ ...base, text: 'Fizyka' }));
});

test('the first scan is a silent baseline that hydrates nothing', () => {
	const plan = planCalendarPoll({}, account, window('2026-09', 1, ['2026-09', '2026-10']), [
		entry('szczegoly/1', '2026-09-18'),
	]);
	assert.equal(plan.baseline, true);
	assert.deepEqual([plan.added, plan.changed, plan.removed, plan.hydrate], [[], [], [], []]);
});

test('additions, edits and disappearances inside the window are detected', () => {
	const state = {
		librusCalendar: {
			version: 1,
			rev: 4,
			account,
			window: { from: '2026-09', monthsAhead: 1 },
			events: {
				'szczegoly/1': { m: '2026-09', f: fingerprint(entry('szczegoly/1', '2026-09-18')), s: {} },
				'szczegoly/2': { m: '2026-09', f: 'stale', s: {} },
				'szczegoly/3': { m: '2026-09', f: 'gone', s: {} },
				'szczegoly/4': { m: '2026-12', f: 'outside', s: {} },
			},
		},
	};
	const plan = planCalendarPoll(state, account, window('2026-09', 1, ['2026-09', '2026-10']), [
		entry('szczegoly/1', '2026-09-18'),
		entry('szczegoly/2', '2026-09-19'),
		entry('szczegoly/9', '2026-10-02'),
	]);
	assert.equal(plan.rev, 4);
	assert.deepEqual(plan.added, ['szczegoly/9']);
	assert.deepEqual(plan.changed, ['szczegoly/2']);
	assert.deepEqual(plan.removed, ['szczegoly/3']);
	assert.deepEqual(plan.hydrate, ['szczegoly/2', 'szczegoly/9']);
});

test('months added by growing the window are baselined silently', () => {
	const state = {
		librusCalendar: {
			version: 1,
			rev: 1,
			account,
			window: { from: '2026-09', monthsAhead: 1 },
			events: {},
		},
	};
	const plan = planCalendarPoll(
		state,
		account,
		window('2026-09', 3, ['2026-09', '2026-10', '2026-11', '2026-12']),
		[entry('szczegoly/1', '2026-09-18'), entry('szczegoly/2', '2026-11-05')],
	);
	assert.deepEqual([...plan.silent], ['2026-11', '2026-12']);
	assert.deepEqual(plan.added, ['szczegoly/1']);
});

test('a window that advances with time keeps emitting the newly reachable month', () => {
	const state = {
		librusCalendar: {
			version: 1,
			rev: 1,
			account,
			window: { from: '2026-09', monthsAhead: 1 },
			events: {},
		},
	};
	const plan = planCalendarPoll(state, account, window('2026-10', 1, ['2026-10', '2026-11']), [
		entry('szczegoly/2', '2026-11-05'),
	]);
	assert.deepEqual([...plan.silent], []);
	assert.deepEqual(plan.added, ['szczegoly/2']);
});

test('switching accounts starts a new silent baseline', () => {
	const state = {
		librusCalendar: {
			version: 1,
			rev: 2,
			account,
			window: { from: '2026-09', monthsAhead: 1 },
			events: { 'szczegoly/1': { m: '2026-09', f: 'x', s: {} } },
		},
	};
	const plan = planCalendarPoll(
		state,
		accountKey('other', 'credential-1'),
		window('2026-09', 1, ['2026-09', '2026-10']),
		[entry('szczegoly/5', '2026-09-18')],
	);
	assert.equal(plan.baseline, true);
	assert.deepEqual(plan.stored, {});
});

test('hydration is capped and ordered so a backlog converges deterministically', () => {
	const entries = Array.from({ length: 120 }, (_, i) =>
		entry(`szczegoly/${String(i).padStart(3, '0')}`, '2026-09-18'),
	);
	const state = {
		librusCalendar: {
			version: 1,
			rev: 0,
			account,
			window: { from: '2026-09', monthsAhead: 0 },
			events: { 'szczegoly/000': { m: '2026-09', f: 'x', s: {} } },
		},
	};
	const plan = planCalendarPoll(state, account, window('2026-09', 0, ['2026-09']), entries);
	assert.equal(plan.hydrate.length, MAX_HYDRATION);
	assert.deepEqual(plan.hydrate, [...plan.hydrate].sort());
});

test('corrupt stored state fails instead of silently resetting history', () => {
	for (const broken of [
		{ librusCalendar: [] },
		{ librusCalendar: { version: 2, rev: 0, account, window: {}, events: {} } },
		{ librusCalendar: { version: 1, rev: -1, account, window: { from: '2026-09', monthsAhead: 1 }, events: {} } },
		{ librusCalendar: { version: 1, rev: 0, account, window: { from: 'x', monthsAhead: 1 }, events: {} } },
		{ librusCalendar: { version: 1, rev: 0, account, window: { from: '2026-09', monthsAhead: 1 }, events: { a: 1 } } },
	])
		assert.throws(
			() => planCalendarPoll(broken, account, window('2026-09', 1, ['2026-09', '2026-10']), []),
			{ message: /Zapisana historia terminarza jest nieprawidłowa/ },
		);
});
