const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
	monthWindow,
	fingerprint,
	planCalendarPoll,
	commitCalendarPoll,
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
const snap = (date = '2026-09-18', text = 'Matematyka') => ({ date, text });

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
				'szczegoly/1': {
					m: '2026-09',
					f: fingerprint(entry('szczegoly/1', '2026-09-18')),
					s: snap('2026-09-18'),
				},
				'szczegoly/2': { m: '2026-09', f: 'stale', s: snap('2026-09-18') },
				'szczegoly/3': { m: '2026-09', f: 'gone', s: snap('2026-09-10') },
				'szczegoly/4': { m: '2026-12', f: 'outside', s: snap('2026-12-01') },
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

test('growth silences only what the growth itself added, not what time already brought in', () => {
	const state = {
		librusCalendar: {
			version: 1,
			rev: 1,
			account,
			window: { from: '2026-09', monthsAhead: 1 },
			events: {},
		},
	};
	// Two months passed and the span was raised from 1 to 3 before the next poll. With the
	// old span, time alone would already have reached 2026-11 and 2026-12, so those months
	// must still emit; only 2027-01 and 2027-02 exist because the span grew.
	const plan = planCalendarPoll(
		state,
		account,
		window('2026-11', 3, ['2026-11', '2026-12', '2027-01', '2027-02']),
		[
			entry('szczegoly/1', '2026-11-05'),
			entry('szczegoly/2', '2026-12-01'),
			entry('szczegoly/3', '2027-01-10'),
		],
	);
	assert.deepEqual([...plan.silent], ['2027-01', '2027-02']);
	assert.deepEqual(plan.added, ['szczegoly/1', 'szczegoly/2']);
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
			events: { 'szczegoly/1': { m: '2026-09', f: 'x', s: snap('2026-09-18') } },
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
			events: { 'szczegoly/000': { m: '2026-09', f: 'x', s: snap('2026-09-18') } },
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
		{
			librusCalendar: {
				version: 1,
				rev: -1,
				account,
				window: { from: '2026-09', monthsAhead: 1 },
				events: {},
			},
		},
		{
			librusCalendar: {
				version: 1,
				rev: 0,
				account,
				window: { from: 'x', monthsAhead: 1 },
				events: {},
			},
		},
		{
			librusCalendar: {
				version: 1,
				rev: 0,
				account,
				window: { from: '2026-09', monthsAhead: 1 },
				events: { a: 1 },
			},
		},
		// `m` is typed but not a month: such a record would be neither prunable nor removable.
		{
			librusCalendar: {
				version: 1,
				rev: 0,
				account,
				window: { from: '2026-09', monthsAhead: 1 },
				events: { 'szczegoly/1': { m: 'wrzesień', f: 'x', s: snap('2026-09-18') } },
			},
		},
		{
			librusCalendar: {
				version: 1,
				rev: 0,
				account,
				window: { from: '2026-09', monthsAhead: 1 },
				events: { 'szczegoly/1': { m: '2026-13', f: 'x', s: snap('2026-09-18') } },
			},
		},
	])
		assert.throws(
			() => planCalendarPoll(broken, account, window('2026-09', 1, ['2026-09', '2026-10']), []),
			{ message: /Zapisana historia terminarza jest nieprawidłowa/ },
		);
});

test('a stored snapshot missing or mistyping date or text is rejected as corrupt', () => {
	const brokenSnapshots = [
		{}, // missing both date and text
		{ text: 'Matematyka' }, // missing date
		{ date: '2026-09-18' }, // missing text
		{ date: 20260918, text: 'Matematyka' }, // date not a string
		{ date: '2026-13-01', text: 'Matematyka' }, // date fails the calendar-shaped regex
		{ date: '2026-09-18', text: 42 }, // text not a string
	];
	for (const s of brokenSnapshots) {
		const state = {
			librusCalendar: {
				version: 1,
				rev: 0,
				account,
				window: { from: '2026-09', monthsAhead: 1 },
				events: { 'szczegoly/1': { m: '2026-09', f: 'x', s } },
			},
		};
		assert.throws(
			() => planCalendarPoll(state, account, window('2026-09', 1, ['2026-09', '2026-10']), []),
			{ message: /Zapisana historia terminarza jest nieprawidłowa/ },
		);
	}
});

test('a valid stored snapshot with date and text still passes validation', () => {
	const state = {
		librusCalendar: {
			version: 1,
			rev: 0,
			account,
			window: { from: '2026-09', monthsAhead: 1 },
			events: { 'szczegoly/1': { m: '2026-09', f: 'x', s: snap('2026-09-18', 'Matematyka') } },
		},
	};
	const plan = planCalendarPoll(state, account, window('2026-09', 1, ['2026-09', '2026-10']), []);
	assert.equal(plan.baseline, false);
});

test('planCalendarPoll hands out a copy of stored events, never the live state reference', () => {
	const state = {
		librusCalendar: {
			version: 1,
			rev: 4,
			account,
			window: { from: '2026-09', monthsAhead: 1 },
			events: {
				'szczegoly/1': { m: '2026-09', f: 'x', s: snap('2026-09-18') },
			},
		},
	};
	const plan = planCalendarPoll(state, account, window('2026-09', 1, ['2026-09', '2026-10']), []);
	assert.notEqual(plan.stored, state.librusCalendar.events);
	plan.stored['szczegoly/2'] = { m: '2026-09', f: 'injected', s: snap('2026-09-20') };
	delete plan.stored['szczegoly/1'];
	assert.deepEqual(Object.keys(state.librusCalendar.events), ['szczegoly/1']);
	assert.equal(state.librusCalendar.events['szczegoly/2'], undefined);
});

const detail = (rodzaj) => ({
	fields: { Rodzaj: rodzaj },
	rodzaj,
	room: '12',
	addedAt: '2026-09-01 12:03:00',
	teacher: 'Jan Kowalski',
	subject: 'Matematyka',
	description: 'Zakres',
	lessonNumber: 3,
	date: '2026-09-18',
});
const run = (state, acct, span, entries, details = new Map()) => {
	const plan = planCalendarPoll(state, acct, span, entries);
	return { plan, ...commitCalendarPoll(state, acct, plan, details) };
};

test('a baseline records everything, emits nothing and leaves no readable content behind', () => {
	const state = {};
	const result = run(state, account, window('2026-09', 1, ['2026-09', '2026-10']), [
		entry('szczegoly/1', '2026-09-18'),
	]);
	assert.deepEqual(result.changes, []);
	assert.equal(state.librusCalendar.rev, 1);
	assert.equal(Object.keys(state.librusCalendar.events).length, 1);
});

test('additions and edits emit hydrated snapshots with previous values and changed fields', () => {
	const state = {};
	const span = window('2026-09', 0, ['2026-09']);
	run(state, account, span, [entry('szczegoly/1', '2026-09-18')]);
	const first = run(
		state,
		account,
		span,
		[entry('szczegoly/1', '2026-09-18'), entry('szczegoly/2', '2026-09-20', 'Fizyka')],
		new Map([['szczegoly/2', detail('Kartkówka')]]),
	);
	assert.deepEqual(
		first.changes.map((change) => [change.changeType, change.key, change.event.rodzaj]),
		[['new', 'szczegoly/2', 'Kartkówka']],
	);
	const second = run(
		state,
		account,
		span,
		[entry('szczegoly/1', '2026-09-25'), entry('szczegoly/2', '2026-09-20', 'Fizyka')],
		new Map([['szczegoly/1', detail('Sprawdzian')]]),
	);
	assert.equal(second.changes.length, 1);
	assert.equal(second.changes[0].changeType, 'changed');
	assert.equal(second.changes[0].previous.date, '2026-09-18');
	assert.ok(second.changes[0].changedFields.includes('date'));
	// szczegoly/2 was not re-hydrated on this poll (fingerprint unchanged, absent from `details`),
	// so its previously hydrated snapshot must survive untouched — this is the same "resolved vs
	// deferred" rule applied to an entry that isn't even a candidate this round.
	assert.equal(state.librusCalendar.events['szczegoly/2'].s.rodzaj, 'Kartkówka');
});

test('a disappearance emits the last known snapshot and drops the key', () => {
	const state = {};
	const span = window('2026-09', 0, ['2026-09']);
	run(state, account, span, [entry('szczegoly/1', '2026-09-18')]);
	const result = run(state, account, span, []);
	assert.deepEqual(
		result.changes.map((change) => [change.changeType, change.key]),
		[['removed', 'szczegoly/1']],
	);
	assert.deepEqual(Object.keys(state.librusCalendar.events), []);
});

test('unresolved hydration defers the entry without emitting or recording it', () => {
	const state = {};
	const span = window('2026-09', 0, ['2026-09']);
	run(state, account, span, []);
	const deferred = run(state, account, span, [entry('szczegoly/7', '2026-09-18')]);
	assert.deepEqual(deferred.changes, []);
	assert.equal('szczegoly/7' in state.librusCalendar.events, false);
	const resolved = run(
		state,
		account,
		span,
		[entry('szczegoly/7', '2026-09-18')],
		new Map([['szczegoly/7', detail('Sprawdzian')]]),
	);
	assert.deepEqual(
		resolved.changes.map((change) => change.changeType),
		['new'],
	);
});

test('a concurrent write aborts the commit and leaves history untouched', () => {
	const state = {};
	const span = window('2026-09', 0, ['2026-09']);
	run(state, account, span, []);
	const plan = planCalendarPoll(state, account, span, [entry('szczegoly/1', '2026-09-18')]);
	state.librusCalendar.rev += 1; // another poll committed while details were fetched
	const result = commitCalendarPoll(
		state,
		account,
		plan,
		new Map([['szczegoly/1', detail('Sprawdzian')]]),
	);
	assert.deepEqual(result, { aborted: true, changes: [] });
	assert.equal('szczegoly/1' in state.librusCalendar.events, false);
});

test('an account change commits a silent baseline instead of aborting every later poll', () => {
	const state = {};
	const span = window('2026-09', 0, ['2026-09']);
	const other = accountKey('other-login', 'credential-2');
	run(state, account, span, [entry('szczegoly/1', '2026-09-18')]);
	const switched = run(
		state,
		other,
		span,
		[entry('szczegoly/2', '2026-09-19')],
		new Map([['szczegoly/2', detail('Sprawdzian')]]),
	);
	assert.equal(switched.aborted, false);
	assert.deepEqual(switched.changes, []);
	assert.equal(state.librusCalendar.account, other);
	assert.deepEqual(Object.keys(state.librusCalendar.events), ['szczegoly/2']);
	const third = run(
		state,
		other,
		span,
		[entry('szczegoly/2', '2026-09-19'), entry('szczegoly/3', '2026-09-20')],
		new Map([['szczegoly/3', detail('Wycieczka')]]),
	);
	assert.deepEqual(
		third.changes.map((change) => [change.changeType, change.key]),
		[['new', 'szczegoly/3']],
	);
});

test('a concurrent write that replaces the owner still aborts the commit', () => {
	const state = {};
	const span = window('2026-09', 0, ['2026-09']);
	run(state, account, span, []);
	const plan = planCalendarPoll(state, account, span, [entry('szczegoly/1', '2026-09-18')]);
	// Another execution re-baselined onto a different account while details were fetched.
	state.librusCalendar.account = accountKey('intruder', 'credential-9');
	const result = commitCalendarPoll(
		state,
		account,
		plan,
		new Map([['szczegoly/1', detail('Sprawdzian')]]),
	);
	assert.deepEqual(result, { aborted: true, changes: [] });
	assert.equal('szczegoly/1' in state.librusCalendar.events, false);
});

test('entries whose month leaves the window are pruned', () => {
	const state = {};
	run(state, account, window('2026-09', 0, ['2026-09']), [entry('szczegoly/1', '2026-09-18')]);
	run(state, account, window('2026-10', 0, ['2026-10']), []);
	assert.deepEqual(Object.keys(state.librusCalendar.events), []);
	assert.equal(state.librusCalendar.window.from, '2026-10');
});

test('one synthetic disappearance plus one synthetic addition on a date read as a change', () => {
	const state = {};
	const span = window('2026-09', 0, ['2026-09']);
	const before = entry('hash/aaaaaaaaaaaaaaaa', '2026-09-18', 'Dzień wolny');
	run(state, account, span, [before]);
	const after = entry('hash/bbbbbbbbbbbbbbbb', '2026-09-18', 'Dzień wolny — odwołany');
	const result = run(state, account, span, [after], new Map([[after.key, null]]));
	assert.equal(result.changes.length, 1);
	assert.equal(result.changes[0].changeType, 'changed');
	assert.equal(result.changes[0].key, after.key);
	assert.equal(result.changes[0].previous.text, 'Dzień wolny');
});

test('exceeding the history cap fails without mutating stored history', () => {
	const state = {};
	const span = window('2026-09', 0, ['2026-09']);
	const entries = Array.from({ length: 2001 }, (_, i) =>
		entry(`szczegoly/${String(i).padStart(5, '0')}`, '2026-09-18'),
	);
	assert.throws(() => run(state, account, span, entries), {
		message: /Osiągnięto limit historii 2000 wydarzeń terminarza/,
	});
	assert.equal(state.librusCalendar, undefined);
});

test('a silently discovered month from a growing window is recorded but never emitted', () => {
	const state = {};
	run(state, account, window('2026-09', 0, ['2026-09']), [entry('szczegoly/1', '2026-09-18')]);
	const result = run(state, account, window('2026-09', 2, ['2026-09', '2026-10', '2026-11']), [
		entry('szczegoly/1', '2026-09-18'),
		entry('szczegoly/9', '2026-11-05'),
	]);
	assert.deepEqual(result.changes, []);
	assert.ok('szczegoly/9' in state.librusCalendar.events);
	assert.equal(state.librusCalendar.events['szczegoly/9'].s.date, '2026-11-05');
});
