# Librus calendar trigger — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two polling events to the Librus Trigger node — a calendar entry was added, and a calendar entry changed (edited, moved to another date, or removed).

**Architecture:** A dependency-free HTML parser turns the monthly `terminarz` grid and the per-entry detail page into typed records. The client gains one credential-free POST target for the month form and a hydration phase driven by a selector callback, so a single login covers scan and detail fetches. A new state module owns the diff: fingerprints computed from the grid, snapshots that give `previous` a payload, a revision counter that aborts on a concurrent write, window pruning, and partial commit so a large backlog converges over several polls instead of failing forever.

**Tech Stack:** TypeScript 5.9, `@n8n/node-cli` 0.46.4, `n8n-workflow` 2.38.1, Node 24 built-in `node:test` + `node:assert/strict`, `node:crypto`. No new runtime dependency.

**Spec:** `docs/superpowers/specs/2026-09-12-terminarz-trigger-design.md`

## Global Constraints

- Node.js >= 24. Never add a runtime dependency; `tough-cookie` stays the only one.
- All user-facing strings (labels, descriptions, hints, error messages) in Polish. Parameter names, option values, output field names and error codes stay English and stable.
- Error messages carry only code-owned labels and primitive type names — never Librus content, credentials, cookies or response bodies.
- `librusTrigger` stays `version: 1`; existing workflows must keep working with `event: 'newMessage'`.
- Every task ends with `npm run check` green (lint + build + all tests) and a commit.
- Tests are CommonJS in `tests/*.test.cjs` and require compiled output from `../dist/...`. `npm test` builds first.
- Bump `package.json` and `package-lock.json` to 0.2.0 and update `CHANGELOG.md` before any push (Task 9).
- The implementer has no live Librus access. Everything is verified by offline fixtures; live checks are written into `docs/live-verification.md`.

## File structure

| File | Responsibility |
|---|---|
| `nodes/Librus/errors.ts` | **New.** `messages`, `LibrusError`, `safeError`, generic `protocolError`. Extracted so the parser can raise protocol errors without importing the client, which would import it back. |
| `nodes/Librus/terminarz.ts` | **New.** Pure parsing: `parseMonth`, `parseEventDetail`, entity and text helpers. No network, no state. |
| `nodes/Librus/calendarState.ts` | **New.** `monthWindow`, `fingerprint`, `planCalendarPoll`, `commitCalendarPoll`. Owns discovery history and the diff. |
| `nodes/Librus/LibrusClient.ts` | Modified. Credential-free POST allowlist, `getCalendar` with its selector callback, `monthPage`, `eventDetail`; re-exports `LibrusError` and `safeError`. |
| `nodes/Librus/LibrusTrigger.node.ts` | Modified. Three events, per-event parameters, calendar poll dispatch, type filter, manual sample. |
| `tests/terminarz.test.cjs` | **New.** Parser fixtures. |
| `tests/calendarState.test.cjs` | **New.** Diff, commit, pruning, limits, races. |
| `tests/client.test.cjs`, `tests/trigger.test.cjs` | Extended. |

---

### Task 1: Extract the error module

Pure refactor, no behaviour change. It exists so `terminarz.ts` can raise `PROTOCOL_ERROR` without importing `LibrusClient.ts`, which would import it back.

**Files:**
- Create: `nodes/Librus/errors.ts`
- Modify: `nodes/Librus/LibrusClient.ts:44-119` (the `messages` map, `AuthStage`, `AuthDestination`, `LibrusError`, `safeError`, `protocolError`)

**Interfaces:**
- Consumes: nothing.
- Produces: `messages`, `LibrusError`, `safeError(error: unknown): LibrusError`, `protocolError(check: string, value?: unknown): LibrusError`. `LibrusClient.ts` re-exports `LibrusError` and `safeError`, so `Librus.node.ts`, `LibrusTrigger.node.ts`, `pollState.ts` and the existing tests keep their current import paths.

- [ ] **Step 1: Create `nodes/Librus/errors.ts`**

Move the existing `messages` object, `AuthStage`, `AuthDestination`, `LibrusError` and `safeError` **verbatim** out of `LibrusClient.ts`, add the two new codes, and add the generic `protocolError`:

```ts
// nodes/Librus/errors.ts
// ... messages, AuthStage, AuthDestination, LibrusError, safeError moved verbatim ...
// add to the messages map:
//   CALENDAR_STATE_INVALID:
//     'Zapisana historia terminarza jest nieprawidłowa. Utwórz ponownie węzeł z wydarzeniem terminarza, aby zapamiętać aktualny kalendarz.',
//   CALENDAR_STATE_LIMIT:
//     'Osiągnięto limit historii 2000 wydarzeń terminarza. Zmniejsz Liczbę miesięcy wprzód lub utwórz węzeł ponownie, aby zapamiętać aktualny kalendarz.',

// Diagnostics contain only code-owned labels and primitive type names, never values.
// Callers pass their own literal-union type, so each module keeps an exhaustive label list.
export function protocolError(check: string, value?: unknown): LibrusError {
	const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
	const error = new LibrusError('PROTOCOL_ERROR');
	error.message += ` [Walidacja: ${check}; otrzymany typ: ${type}]`;
	return error;
}
```

- [ ] **Step 2: Rewire `LibrusClient.ts`**

Replace the moved block with an import, a re-export, and a locally typed wrapper that preserves the existing exhaustive label union:

```ts
import { LibrusError, protocolError as baseProtocolError, safeError } from './errors';
export { LibrusError, safeError };

type ProtocolCheck =
	| `message.${keyof Message}`
	| 'obiekt wiadomości'
	/* ... the rest of the existing union, unchanged ... */;
function protocolError(check: ProtocolCheck, value?: unknown): LibrusError {
	return baseProtocolError(check, value);
}
```

- [ ] **Step 3: Add a `status` field to `LibrusError` so callers can recognise a 404**

In `errors.ts`, add a mutable optional field to the class body. Task 5 needs to tell a missing detail page from a real service failure without changing any message text:

```ts
export class LibrusError extends Error {
	/** HTTP status when the failure came from a response. Never shown to users. */
	status?: number;
	// ... existing constructor unchanged ...
}
```

In `LibrusClient.request`, replace the bare `SERVICE_ERROR` throw:

```ts
if (response.statusCode < 200 || response.statusCode >= 300) {
	const error = new LibrusError('SERVICE_ERROR');
	error.status = response.statusCode;
	throw error;
}
```

- [ ] **Step 4: Run the whole suite unchanged**

Run: `npm run check`
Expected: lint clean, build clean, all existing tests pass with no test edits. A failure means the extraction changed behaviour — revert and redo it verbatim.

- [ ] **Step 5: Commit**

```bash
git add nodes/Librus/errors.ts nodes/Librus/LibrusClient.ts
git commit -m "Extract the shared error module from the Librus client"
```

---

### Task 2: Month grid parser

**Files:**
- Create: `nodes/Librus/terminarz.ts`
- Test: `tests/terminarz.test.cjs`

**Interfaces:**
- Consumes: `protocolError` from Task 1.
- Produces:

```ts
export interface CalendarEntry {
	key: string;              // 'szczegoly/123', 'szczegoly_wolne/9', or 'hash/<16 hex>'
	route: 'szczegoly' | 'szczegoly_wolne' | null;
	eventId: string | null;
	date: string;             // YYYY-MM-DD
	subject: string | null;
	teacher: string | null;
	description: string | null;
	lessonNumber: number | null;
	hour: string | null;      // HH:MM
	text: string;             // normalized cell text, newline separated
}
export function parseMonth(html: string, year: number, month: number): CalendarEntry[];
export function decodeEntities(value: string): string;
```

- [ ] **Step 1: Write the failing tests**

```js
// tests/terminarz.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseMonth, decodeEntities } = require('../dist/nodes/Librus/terminarz');

const day = (number, rows = '') =>
	`<div class="kalendarz-dzien"><div class="kalendarz-numer-dnia">${number}</div><table>${rows}</table></div>`;
const month = (year, index, days) => {
	const length = new Date(Date.UTC(year, index, 0)).getUTCDate();
	return `<html><body><table class="kalendarz decorated center"><tbody>${Array.from(
		{ length },
		(_, i) => days[i + 1] ?? day(i + 1),
	).join('')}</tbody></table></body></html>`;
};
const cell = (attrs, body) => `<tr><td ${attrs}>${body}</td></tr>`;

test('reads linked entries with subject, teacher, description, lesson number and hour', () => {
	const rows = cell(
		`onclick="location.href='/terminarz/szczegoly/123456'" title="Nauczyciel: Jan Kowalski&lt;br /&gt;Opis: Zakres: u&#322;amki"`,
		'<span>Matematyka</span><br>Sprawdzian, lekcja: 3, godz. 10:45',
	);
	const entries = parseMonth(month(2026, 9, { 18: day(18, rows) }), 2026, 9);
	assert.equal(entries.length, 1);
	assert.deepEqual(
		{ ...entries[0] },
		{
			key: 'szczegoly/123456',
			route: 'szczegoly',
			eventId: '123456',
			date: '2026-09-18',
			subject: 'Matematyka',
			teacher: 'Jan Kowalski',
			description: 'Zakres: ułamki',
			lessonNumber: 3,
			hour: '10:45',
			text: 'Matematyka\nSprawdzian, lekcja: 3, godz. 10:45',
		},
	);
});

test('an entry without a link gets a stable synthetic key derived from date and text', () => {
	const rows = cell('class="nb"', 'Dzień wolny od zajęć');
	const first = parseMonth(month(2026, 9, { 2: day(2, rows) }), 2026, 9)[0];
	const again = parseMonth(month(2026, 9, { 2: day(2, rows) }), 2026, 9)[0];
	assert.match(first.key, /^hash\/[0-9a-f]{16}$/);
	assert.equal(first.key, again.key);
	assert.equal(first.route, null);
	assert.equal(first.eventId, null);
	const moved = parseMonth(month(2026, 9, { 3: day(3, rows) }), 2026, 9)[0];
	assert.notEqual(moved.key, first.key);
});

test('an empty month is legitimate and yields no entries', () => {
	assert.deepEqual(parseMonth(month(2026, 7, {}), 2026, 7), []);
});

test('a page without the day grid fails instead of reporting an empty calendar', () => {
	assert.throws(() => parseMonth('<html><body><p>Brak dostępu</p></body></html>', 2026, 9), {
		message: /Walidacja: siatka terminarza/,
	});
});

test('an incomplete or duplicated day grid fails rather than guessing dates', () => {
	const short = `<table>${day(1)}${day(2)}</table>`;
	assert.throws(() => parseMonth(short, 2026, 9), { message: /Walidacja: numery dni miesiąca/ });
	const duplicated = month(2026, 9, { 30: day(1) });
	assert.throws(() => parseMonth(duplicated, 2026, 9), {
		message: /Walidacja: numery dni miesiąca/,
	});
});

test('named, decimal, hexadecimal entities and non-breaking spaces decode', () => {
	assert.equal(decodeEntities('a&amp;b&nbsp;c&#322;&#x142;&quot;'), 'a&b\u00a0cłł"');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../dist/nodes/Librus/terminarz'`.

- [ ] **Step 3: Implement `nodes/Librus/terminarz.ts`**

```ts
import { createHash } from 'node:crypto';
import { protocolError as baseProtocolError, type LibrusError } from './errors';

export interface CalendarEntry {
	key: string;
	route: 'szczegoly' | 'szczegoly_wolne' | null;
	eventId: string | null;
	date: string;
	subject: string | null;
	teacher: string | null;
	description: string | null;
	lessonNumber: number | null;
	hour: string | null;
	text: string;
}

type TerminarzCheck =
	| 'siatka terminarza'
	| 'numery dni miesiąca'
	| 'tabela szczegółów'
	| 'dokument HTML';
function protocolError(check: TerminarzCheck, value?: unknown): LibrusError {
	return baseProtocolError(check, value);
}

const named: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: '\u00a0',
};
export function decodeEntities(value: string): string {
	return value.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (match, name: string) => {
		const code = name.startsWith('#')
			? Number(name[1] === 'x' || name[1] === 'X' ? `0x${name.slice(2)}` : name.slice(1))
			: NaN;
		if (Number.isInteger(code) && code > 0 && code <= 0x10ffff) return String.fromCodePoint(code);
		return named[name.toLowerCase()] ?? match;
	});
}

/** Tag stripped, entity decoded, whitespace collapsed. A <br> becomes a line break. */
function text(html: string): string {
	return decodeEntities(html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, ''))
		.replace(/\u00a0/g, ' ')
		.split('\n')
		.map((line) => line.replace(/\s+/g, ' ').trim())
		.filter((line) => line)
		.join('\n');
}

function attributes(tag: string): Record<string, string> {
	const result: Record<string, string> = {};
	for (const match of tag.matchAll(/([a-zA-Z_:][-\w:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))
		result[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? '');
	return result;
}

/** The title attribute holds literal `<br />` separated `Etykieta: wartość` pairs. */
function titlePairs(title: string): Record<string, string> {
	const pairs: Record<string, string> = {};
	for (const part of title.split(/<br\s*\/?>/i)) {
		const index = part.indexOf(':');
		if (index <= 0) continue;
		pairs[part.slice(0, index).trim().toLocaleLowerCase('pl')] = part.slice(index + 1).trim();
	}
	return pairs;
}

function entry(date: string, attrs: Record<string, string>, body: string): CalendarEntry {
	const link = /\/terminarz\/(szczegoly_wolne|szczegoly)\/(\d+)/.exec(attrs.onclick ?? '');
	const pairs = titlePairs(attrs.title ?? '');
	const lesson = /lekcj\w*\s*:?\s*(\d{1,2})\b/i.exec(body);
	const hour = /\b([01]?\d|2[0-3]):([0-5]\d)\b/.exec(body);
	return {
		key: link
			? `${link[1]}/${link[2]}`
			: `hash/${createHash('sha256').update(`${date} ${body}`).digest('hex').slice(0, 16)}`,
		route: link ? (link[1] as 'szczegoly' | 'szczegoly_wolne') : null,
		eventId: link ? link[2] : null,
		date,
		subject: body.split('\n')[0] ?? null,
		teacher: pairs.nauczyciel ?? null,
		description: pairs.opis ?? null,
		lessonNumber: lesson ? Number(lesson[1]) : null,
		hour: hour ? `${hour[1].padStart(2, '0')}:${hour[2]}` : null,
		text: body,
	};
}

export function parseMonth(html: string, year: number, month: number): CalendarEntry[] {
	if (typeof html !== 'string') throw protocolError('dokument HTML', html);
	const blocks = [...html.matchAll(/<div\b[^>]*class="[^"]*\bkalendarz-dzien\b[^"]*"[^>]*>/gi)];
	if (!blocks.length) throw protocolError('siatka terminarza', blocks.length);
	const days = new Set<number>();
	const entries: CalendarEntry[] = [];
	for (const [index, block] of blocks.entries()) {
		const start = (block.index ?? 0) + block[0].length;
		const end = index + 1 < blocks.length ? (blocks[index + 1].index ?? html.length) : html.length;
		const chunk = html.slice(start, end);
		const label =
			/<div\b[^>]*class="[^"]*\bkalendarz-numer-dnia\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(chunk);
		const day = label ? Number(text(label[1])) : NaN;
		if (!Number.isInteger(day) || day < 1 || day > 31 || days.has(day))
			throw protocolError('numery dni miesiąca', day);
		days.add(day);
		const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
		for (const cell of chunk.matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/gi)) {
			const body = text(cell[2]);
			if (body) entries.push(entry(date, attributes(cell[1]), body));
		}
	}
	// A calendar may legitimately be empty, but it always renders every day of the month.
	// A missing or duplicated day number means this is not the grid we think it is,
	// and silently mis-dating an event is worse than failing the poll.
	const length = new Date(Date.UTC(year, month, 0)).getUTCDate();
	if (days.size !== length || Math.max(...days) !== length)
		throw protocolError('numery dni miesiąca', days.size);
	return entries;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: PASS, including the existing suites.

- [ ] **Step 5: Commit**

```bash
git add nodes/Librus/terminarz.ts tests/terminarz.test.cjs
git commit -m "Parse the Librus month calendar grid without a HTML dependency"
```

---

### Task 3: Detail page parser

**Files:**
- Modify: `nodes/Librus/terminarz.ts`
- Test: `tests/terminarz.test.cjs`

**Interfaces:**
- Consumes: `text` and `protocolError` from Task 2.
- Produces:

```ts
export interface CalendarDetail {
	fields: Record<string, string>;   // raw Librus labels, passed through to workflow output
	rodzaj: string | null;
	room: string | null;
	addedAt: string | null;
	teacher: string | null;
	subject: string | null;
	description: string | null;
	lessonNumber: number | null;
	date: string | null;
}
export function parseEventDetail(html: string): CalendarDetail;
```

- [ ] **Step 1: Write the failing tests**

```js
// append to tests/terminarz.test.cjs, and add parseEventDetail to the existing require at the top
const { parseEventDetail } = require('../dist/nodes/Librus/terminarz');

const detail = (rows) =>
	`<div class="container-background"><table class="decorated medium center"><tbody>${rows
		.map(
			([label, value], index) =>
				`<tr class="line${index % 2}"><th>${label}</th><td>${value}</td></tr>`,
		)
		.join('')}</tbody></table></div>`;

test('maps the detail table onto named fields and keeps the raw labels', () => {
	const parsed = parseEventDetail(
		detail([
			['Data', '2026-09-18'],
			['Nr lekcji', '3'],
			['Nauczyciel', 'Jan Kowalski'],
			['Rodzaj', 'Sprawdzian'],
			['Przedmiot', 'Matematyka'],
			['Sala', '12'],
			['Opis', 'Zakres:&nbsp;ułamki<br />i procenty'],
			['Data dodania', '2026-09-01 12:03:00'],
		]),
	);
	assert.equal(parsed.rodzaj, 'Sprawdzian');
	assert.equal(parsed.room, '12');
	assert.equal(parsed.lessonNumber, 3);
	assert.equal(parsed.description, 'Zakres: ułamki\ni procenty');
	assert.equal(parsed.addedAt, '2026-09-01 12:03:00');
	assert.equal(parsed.fields['Przedmiot'], 'Matematyka');
});

test('a teacher absence detail with different labels still parses', () => {
	const parsed = parseEventDetail(
		detail([
			['Nauczyciel', 'Anna Nowak'],
			['Przedział czasu', '2026-09-18 - 2026-09-20'],
			['Data dodania', '2026-09-10 08:00:00'],
		]),
	);
	assert.equal(parsed.rodzaj, null);
	assert.equal(parsed.teacher, 'Anna Nowak');
	assert.equal(parsed.fields['Przedział czasu'], '2026-09-18 - 2026-09-20');
});

test('a page that is not a detail table fails loudly', () => {
	assert.throws(() => parseEventDetail('<html><body><p>Błąd</p></body></html>'), {
		message: /Walidacja: tabela szczegółów/,
	});
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — `parseEventDetail is not a function`.

- [ ] **Step 3: Implement `parseEventDetail` in `nodes/Librus/terminarz.ts`**

```ts
export interface CalendarDetail {
	fields: Record<string, string>;
	rodzaj: string | null;
	room: string | null;
	addedAt: string | null;
	teacher: string | null;
	subject: string | null;
	description: string | null;
	lessonNumber: number | null;
	date: string | null;
}

export function parseEventDetail(html: string): CalendarDetail {
	if (typeof html !== 'string') throw protocolError('dokument HTML', html);
	const fields: Record<string, string> = {};
	for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
		const label = /<th\b[^>]*>([\s\S]*?)<\/th>/i.exec(row[1]);
		const value = /<td\b[^>]*>([\s\S]*?)<\/td>/i.exec(row[1]);
		if (!label || !value) continue;
		const name = text(label[1]).replace(/:$/, '').trim();
		if (name && !(name in fields)) fields[name] = text(value[1]);
	}
	// Label sets differ between entry kinds, so require structure, not specific labels.
	if (Object.keys(fields).length < 2)
		throw protocolError('tabela szczegółów', Object.keys(fields).length);
	const lesson = fields['Nr lekcji'] ? Number(fields['Nr lekcji']) : NaN;
	return {
		fields,
		rodzaj: fields['Rodzaj'] ?? null,
		room: fields['Sala'] ?? null,
		addedAt: fields['Data dodania'] ?? null,
		teacher: fields['Nauczyciel'] ?? null,
		subject: fields['Przedmiot'] ?? null,
		description: fields['Opis'] ?? null,
		lessonNumber: Number.isInteger(lesson) && lesson >= 0 ? lesson : null,
		date: fields['Data'] ?? null,
	};
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add nodes/Librus/terminarz.ts tests/terminarz.test.cjs
git commit -m "Parse Librus calendar entry detail pages"
```

---

### Task 4: Client — credential-free POST target and month fetching

**Files:**
- Modify: `nodes/Librus/LibrusClient.ts`
- Test: `tests/client.test.cjs`

**Interfaces:**
- Consumes: `parseMonth`, `CalendarEntry` from Task 2.
- Produces:

```ts
export interface CalendarScan {
	months: string[];        // 'YYYY-MM', 1..7 entries, ascending
}
export type CalendarSelect = (entries: CalendarEntry[]) => string[];
export interface CalendarResult {
	entries: CalendarEntry[];
	details: Map<string, CalendarDetail | null>;
}
// Task 4 lands getCalendar with the scan phase only; Task 5 fills in hydration.
async getCalendar(options: CalendarScan, select: CalendarSelect): Promise<CalendarResult>;
```

**Why a selector callback rather than two public methods:** hydration targets depend on a diff that depends on the scan, and every public client method performs its own login. A callback keeps scan and hydration inside one session, one 120-second budget and one session-expiry recovery. The callback must stay synchronous and side-effect-free, because a recovered session re-runs the whole scan and calls it again.

- [ ] **Step 1: Write the failing tests**

```js
// append to tests/client.test.cjs
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
	await assert.rejects(client.getCalendar({ months: ['2026-09'] }, () => []), {
		message: /Walidacja: przekierowanie POST/,
	});
	assert.equal(calls.filter((call) => call.url.endsWith('/terminarz/inny')).length, 0);
});

test('a month form redirected to the login page reports an expired session', async () => {
	const { client } = setup([...auth(), redirect('https://synergia.librus.pl/loguj')]);
	await assert.rejects(client.getCalendar({ months: ['2026-09'] }, () => []), {
		message: /Sesja Librusa wygasła/,
	});
});

test('a login form returned instead of the grid reports an expired session', async () => {
	const form =
		'<form><input name="login" /><input name="pass" type="password" /></form>';
	const { client } = setup([...auth(), ok(form), ...auth(), ok(form)]);
	await assert.rejects(client.getCalendar({ months: ['2026-09'] }, () => []), {
		message: /Sesja Librusa wygasła/,
	});
});

test('a broken grid fails with the month in the diagnostics and never returns an empty calendar', async () => {
	const { client } = setup([...auth(), ok('<html><body>Awaria</body></html>')]);
	await assert.rejects(client.getCalendar({ months: ['2026-09'] }, () => []), {
		message: /Walidacja: siatka terminarza.*Miesiąc terminarza: 2026-09/s,
	});
});

test('rejects malformed month windows before touching the network', async () => {
	const { client } = setup([]);
	for (const months of [[], ['2026-9'], ['2026-13'], Array(8).fill('2026-09'), 'no'])
		await assert.rejects(client.getCalendar({ months }, () => []), {
			message: /Nieprawidłowe dane logowania do Librusa/,
		});
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — `client.getCalendar is not a function`.

- [ ] **Step 3: Widen the POST boundary in `nodes/Librus/LibrusClient.ts`**

Add the allowlist next to `allowedHosts`:

```ts
// Credential-free POST targets. The password may still only leave through the OAuth route.
const allowedPostUrls = new Set(['https://synergia.librus.pl/terminarz']);
```

In `request`, replace the POST guard:

```ts
if (body !== undefined && !authUrl(url) && !allowedPostUrls.has(`${url.origin}${url.pathname}`))
	throw new LibrusError('UNSAFE_URL');
```

And replace the POST branch of the redirect handling. A POST is still never followed and never replayed; the only change is that an expiry now says so:

```ts
if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
	// Never replay a credential-bearing POST, including on a same-host redirect.
	if (body !== undefined) {
		const location = normalized.location;
		if (!authUrl(url) && typeof location === 'string') {
			let target: URL | undefined;
			try {
				target = checkedRedirect(location, url.href);
			} catch {
				target = undefined;
			}
			if (target && (authUrl(target) || /^\/loguj(?:\/|$)/.test(target.pathname)))
				throw new LibrusError('SESSION_EXPIRED');
		}
		throw protocolError('przekierowanie POST');
	}
	// ... existing GET redirect handling unchanged ...
}
```

- [ ] **Step 4: Add the month fetch and the scan phase**

```ts
import { parseMonth, type CalendarDetail, type CalendarEntry } from './terminarz';

export interface CalendarScan {
	months: string[];
}
export type CalendarSelect = (entries: CalendarEntry[]) => string[];
export interface CalendarResult {
	entries: CalendarEntry[];
	details: Map<string, CalendarDetail | null>;
}

	private async monthPage(year: number, month: number): Promise<CalendarEntry[]> {
		const body = new URLSearchParams({
			rok: String(year),
			miesiac: String(month),
		}).toString();
		const response = await this.request('https://synergia.librus.pl/terminarz', body);
		if (
			authUrl(response.url) ||
			/\/loguj(?:\/|$)/.test(response.url.pathname) ||
			isLoginForm(response.body)
		)
			throw new LibrusError('SESSION_EXPIRED');
		if (
			response.url.hostname !== 'synergia.librus.pl' ||
			!/^\/terminarz\/?$/.test(response.url.pathname)
		)
			throw protocolError('adres terminarza');
		try {
			return parseMonth(response.body, year, month);
		} catch (error) {
			if (error instanceof LibrusError && error.code === 'PROTOCOL_ERROR')
				error.message += ` [Miesiąc terminarza: ${year}-${String(month).padStart(2, '0')}]`;
			throw error;
		}
	}

	async getCalendar(options: CalendarScan, select: CalendarSelect): Promise<CalendarResult> {
		if (
			!this.login.username ||
			!this.login.password ||
			typeof select !== 'function' ||
			!Array.isArray(options.months) ||
			options.months.length < 1 ||
			options.months.length > 7 ||
			options.months.some((month) => !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month))
		)
			throw new LibrusError('INVALID_OPTIONS');
		this.deadline = Date.now() + 120000;
		this.requests = 0;
		await this.authenticate();
		for (let attempt = 0; attempt < 2; attempt++) {
			try {
				const entries: CalendarEntry[] = [];
				for (const month of options.months) {
					const [year, index] = month.split('-').map(Number);
					if (year < 2000 || year > 2100) throw new LibrusError('INVALID_OPTIONS');
					entries.push(...(await this.monthPage(year, index)));
				}
				// Hydration lands in Task 5; the selector is already called so that a
				// recovered session re-runs scan and selection together.
				select(entries);
				return { entries, details: new Map<string, CalendarDetail | null>() };
			} catch (error) {
				if (!(error instanceof LibrusError) || error.code !== 'SESSION_EXPIRED' || attempt === 1)
					throw error;
				await this.authenticate();
			}
		}
		throw new LibrusError('SESSION_EXPIRED');
	}
```

Add `'adres terminarza'` to the existing `ProtocolCheck` union.

- [ ] **Step 5: Run to verify it passes**

Run: `npm run check`
Expected: PASS, including every pre-existing client test. In particular the existing assertion that a credential POST is never redirected must still hold.

- [ ] **Step 6: Commit**

```bash
git add nodes/Librus/LibrusClient.ts tests/client.test.cjs
git commit -m "Fetch Librus calendar months through a credential-free POST target"
```

---

### Task 5: Client — detail hydration

**Files:**
- Modify: `nodes/Librus/LibrusClient.ts`
- Test: `tests/client.test.cjs`

**Interfaces:**
- Consumes: `getCalendar` and `CalendarResult` from Task 4, `parseEventDetail` from Task 3.
- Produces: the hydration contract that Task 7 depends on — **a key present in `details` (even with a `null` value) is safe to commit; a key absent from `details` was not resolved and must be retried on the next poll.**

- [ ] **Step 1: Write the failing tests**

```js
// append to tests/client.test.cjs
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
	assert.equal(
		calls.at(-1).url,
		'https://synergia.librus.pl/terminarz/szczegoly/11',
	);
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
		Array.from({ length: 30 }, (_, day) => [day + 1, entryRow(day + 1, 'Test') + entryRow(day + 101, 'Test')]),
	);
	const { client } = setup([...auth(), ok(grid(2026, 9, rows)), ...Array(50).fill(ok(sampleDetail))]);
	const result = await client.getCalendar({ months: ['2026-09'] }, (entries) =>
		entries.map((entry) => entry.key),
	);
	assert.equal(result.details.size, 50);
});

test('an expired session during hydration restarts scan and selection once', async () => {
	let selections = 0;
	const { client } = setup([
		...auth(),
		ok(grid(2026, 9, { 18: entryRow(11, 'Matematyka') })),
		redirect('https://synergia.librus.pl/loguj'),
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — `result.details.get(...)` is undefined because Task 4 always returns an empty map.

- [ ] **Step 3: Implement hydration**

Extend the Task 4 import to `import { parseEventDetail, parseMonth, type CalendarDetail, type CalendarEntry } from './terminarz';`, then add the detail fetch:

```ts
	private async eventDetail(route: string, id: string): Promise<CalendarDetail | null> {
		if ((route !== 'szczegoly' && route !== 'szczegoly_wolne') || !/^\d+$/.test(id))
			throw new LibrusError('PROTOCOL_ERROR');
		let response;
		try {
			response = await this.request(`https://synergia.librus.pl/terminarz/${route}/${id}`);
		} catch (error) {
			// The entry disappeared between the scan and hydration. Leave it unresolved.
			if (error instanceof LibrusError && error.code === 'SERVICE_ERROR' && error.status === 404)
				return null;
			throw error;
		}
		if (
			authUrl(response.url) ||
			/\/loguj(?:\/|$)/.test(response.url.pathname) ||
			isLoginForm(response.body)
		)
			throw new LibrusError('SESSION_EXPIRED');
		return parseEventDetail(response.body);
	}
```

Replace the `select(entries)` line in `getCalendar` with the hydration loop:

```ts
				const known = new Map(entries.map((entry) => [entry.key, entry]));
				const selected = select(entries);
				if (!Array.isArray(selected)) throw new LibrusError('INVALID_OPTIONS');
				const details = new Map<string, CalendarDetail | null>();
				// Bounded independently of the caller. Keys left out stay unresolved,
				// which the state module treats as "retry on the next poll".
				for (const key of selected.slice(0, MAX_DETAILS)) {
					const entry = known.get(key);
					if (!entry) continue;
					if (!entry.route || !entry.eventId) {
						details.set(key, null);
						continue;
					}
					const detail = await this.eventDetail(entry.route, entry.eventId);
					if (detail !== null) details.set(key, detail);
				}
				return { entries, details };
```

with the constant beside the other client limits:

```ts
/** Detail fetches per calendar poll. calendarState.MAX_HYDRATION must not exceed this. */
const MAX_DETAILS = 50;
```

Note the deliberate asymmetry: an entry with no detail link is recorded as `null` (resolved, nothing more to fetch), while a 404 is *not* recorded (unresolved, retried next poll).

- [ ] **Step 4: Run to verify it passes**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add nodes/Librus/LibrusClient.ts tests/client.test.cjs
git commit -m "Hydrate selected Librus calendar entries within one session"
```

---

### Task 6: Calendar state — window, fingerprint and the poll plan

**Files:**
- Create: `nodes/Librus/calendarState.ts`
- Test: `tests/calendarState.test.cjs`

**Interfaces:**
- Consumes: `CalendarEntry`, `CalendarDetail` from Tasks 2 and 3; `LibrusError` from Task 1.
- Produces:

```ts
export const MAX_EVENTS = 2000;
export const MAX_HYDRATION = 50;
export interface CalendarWindow { from: string; monthsAhead: number; months: string[] }
export interface CalendarSnapshot {
	date: string;
	text: string;
	subject: string | null;
	teacher: string | null;
	description: string | null;
	lessonNumber: number | null;
	hour: string | null;
	rodzaj: string | null;
	room: string | null;
	addedAt: string | null;
}
export interface StoredEvent { m: string; f: string; s: CalendarSnapshot }
export interface CalendarPlan {
	rev: number;
	baseline: boolean;
	window: CalendarWindow;
	silent: Set<string>;
	entries: Map<string, CalendarEntry>;
	stored: Record<string, StoredEvent>;
	added: string[];
	changed: string[];
	removed: string[];
	hydrate: string[];
}
export function monthWindow(now: Date, monthsAhead: number): CalendarWindow;
export function fingerprint(entry: CalendarEntry): string;
export function planCalendarPoll(
	state: IDataObject,
	account: string,
	window: CalendarWindow,
	entries: CalendarEntry[],
): CalendarPlan;
```

`planCalendarPoll` only reads state. It never writes, so a recovered session may call it again safely.

- [ ] **Step 1: Write the failing tests**

```js
// tests/calendarState.test.cjs
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../dist/nodes/Librus/calendarState'`.

- [ ] **Step 3: Implement the plan half of `nodes/Librus/calendarState.ts`**

```ts
import { createHash } from 'node:crypto';
import type { IDataObject } from 'n8n-workflow';
import { LibrusError } from './errors';
import type { CalendarEntry } from './terminarz';

export const MAX_EVENTS = 2000;
/** Must not exceed MAX_DETAILS in LibrusClient; the client bounds hydration independently. */
export const MAX_HYDRATION = 50;

export interface CalendarWindow {
	from: string;
	monthsAhead: number;
	months: string[];
}
export interface CalendarSnapshot {
	date: string;
	text: string;
	subject: string | null;
	teacher: string | null;
	description: string | null;
	lessonNumber: number | null;
	hour: string | null;
	rodzaj: string | null;
	room: string | null;
	addedAt: string | null;
}
export interface StoredEvent {
	m: string;
	f: string;
	s: CalendarSnapshot;
}
export interface CalendarPlan {
	rev: number;
	baseline: boolean;
	window: CalendarWindow;
	silent: Set<string>;
	entries: Map<string, CalendarEntry>;
	stored: Record<string, StoredEvent>;
	added: string[];
	changed: string[];
	removed: string[];
	hydrate: string[];
}

export function monthWindow(now: Date, monthsAhead: number): CalendarWindow {
	if (!Number.isInteger(monthsAhead) || monthsAhead < 0 || monthsAhead > 6)
		throw new LibrusError('INVALID_OPTIONS');
	const months: string[] = [];
	for (let offset = 0; offset <= monthsAhead; offset++) {
		const date = new Date(now.getFullYear(), now.getMonth() + offset, 1);
		months.push(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`);
	}
	return { from: months[0], monthsAhead, months };
}

export function monthOf(date: string): string {
	return date.slice(0, 7);
}

function addMonths(from: string, count: number): string {
	const [year, month] = from.split('-').map(Number);
	const date = new Date(year, month - 1 + count, 1);
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Derived fields (subject, lesson number, hour) come from the same cell text, so the
 * fingerprint covers the text itself. That keeps best-effort sub-field extraction from
 * ever producing a false "changed".
 */
export function fingerprint(entry: CalendarEntry): string {
	return createHash('sha256')
		.update(JSON.stringify([entry.date, entry.text, entry.teacher, entry.description]))
		.digest('hex')
		.slice(0, 32);
}

function validWindow(value: unknown): boolean {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
	const window = value as Record<string, unknown>;
	return (
		typeof window.from === 'string' &&
		/^\d{4}-(?:0[1-9]|1[0-2])$/.test(window.from) &&
		Number.isInteger(window.monthsAhead) &&
		(window.monthsAhead as number) >= 0 &&
		(window.monthsAhead as number) <= 6
	);
}

function validEvents(value: unknown): boolean {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
	const events = value as Record<string, unknown>;
	if (Object.keys(events).length > MAX_EVENTS) return false;
	return Object.values(events).every((record) => {
		if (typeof record !== 'object' || record === null || Array.isArray(record)) return false;
		const stored = record as Record<string, unknown>;
		return (
			typeof stored.m === 'string' &&
			typeof stored.f === 'string' &&
			!!stored.f &&
			typeof stored.s === 'object' &&
			stored.s !== null &&
			!Array.isArray(stored.s)
		);
	});
}

export function planCalendarPoll(
	state: IDataObject,
	account: string,
	window: CalendarWindow,
	entries: CalendarEntry[],
): CalendarPlan {
	const raw: unknown = state.librusCalendar;
	if (raw !== undefined && (!raw || typeof raw !== 'object' || Array.isArray(raw)))
		throw new LibrusError('CALENDAR_STATE_INVALID');
	const previous = raw as Record<string, unknown> | undefined;
	let stored: Record<string, StoredEvent> = {};
	let rev = 0;
	let baseline = true;
	let horizon: string | undefined;
	let storedAhead = -1;
	if (previous !== undefined) {
		if (
			previous.version !== 1 ||
			typeof previous.account !== 'string' ||
			!Number.isInteger(previous.rev) ||
			(previous.rev as number) < 0 ||
			!validWindow(previous.window) ||
			!validEvents(previous.events)
		)
			throw new LibrusError('CALENDAR_STATE_INVALID');
		rev = previous.rev as number;
		if (previous.account === account) {
			stored = previous.events as Record<string, StoredEvent>;
			baseline = false;
			const saved = previous.window as { from: string; monthsAhead: number };
			storedAhead = saved.monthsAhead;
			horizon = addMonths(saved.from, saved.monthsAhead);
		}
	}
	// Months that appear only because the configured span grew were never observable
	// before, so they are recorded without emitting. A window advancing with time is
	// ordinary discovery and still emits.
	const silent = new Set<string>();
	if (!baseline && horizon !== undefined && window.monthsAhead > storedAhead)
		for (const month of window.months) if (month > horizon) silent.add(month);
	const map = new Map(entries.map((entry) => [entry.key, entry]));
	const added: string[] = [];
	const changed: string[] = [];
	if (!baseline)
		for (const [key, entry] of map) {
			if (silent.has(monthOf(entry.date))) continue;
			const record = stored[key];
			if (!record) added.push(key);
			else if (record.f !== fingerprint(entry)) changed.push(key);
		}
	const scanned = new Set(window.months);
	const removed = baseline
		? []
		: Object.keys(stored).filter(
				(key) => scanned.has(stored[key].m) && !silent.has(stored[key].m) && !map.has(key),
			);
	const hydrate = [...added, ...changed].sort().slice(0, MAX_HYDRATION);
	return { rev, baseline, window, silent, entries: map, stored, added, changed, removed, hydrate };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add nodes/Librus/calendarState.ts tests/calendarState.test.cjs
git commit -m "Plan Librus calendar polls against stored discovery history"
```

---

### Task 7: Calendar state — commit and emission

**Files:**
- Modify: `nodes/Librus/calendarState.ts`
- Test: `tests/calendarState.test.cjs`

**Interfaces:**
- Consumes: everything from Task 6, plus `CalendarDetail` from Task 3.
- Produces:

```ts
export interface CalendarChange {
	changeType: 'new' | 'changed' | 'removed';
	key: string;
	route: string | null;
	eventId: string | null;
	event: CalendarSnapshot;
	previous: CalendarSnapshot | null;
	changedFields: string[];
}
export function entrySnapshot(
	entry: CalendarEntry,
	detail: CalendarDetail | null,
): CalendarSnapshot;
export function commitCalendarPoll(
	state: IDataObject,
	account: string,
	plan: CalendarPlan,
	details: Map<string, CalendarDetail | null>,
): { aborted: boolean; changes: CalendarChange[] };
```

- [ ] **Step 1: Write the failing tests**

```js
// append to tests/calendarState.test.cjs
const { commitCalendarPoll } = require('../dist/nodes/Librus/calendarState');

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
const run = (state, account, window, entries, details = new Map()) => {
	const plan = planCalendarPoll(state, account, window, entries);
	return { plan, ...commitCalendarPoll(state, account, plan, details) };
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — `commitCalendarPoll is not a function`.

- [ ] **Step 3: Implement the commit half**

```ts
import type { CalendarDetail } from './terminarz';

export interface CalendarChange {
	changeType: 'new' | 'changed' | 'removed';
	key: string;
	route: string | null;
	eventId: string | null;
	event: CalendarSnapshot;
	previous: CalendarSnapshot | null;
	changedFields: string[];
}

export function entrySnapshot(
	entry: CalendarEntry,
	detail: CalendarDetail | null,
): CalendarSnapshot {
	return {
		date: entry.date,
		text: entry.text,
		subject: detail?.subject ?? entry.subject,
		teacher: detail?.teacher ?? entry.teacher,
		description: detail?.description ?? entry.description,
		lessonNumber: detail?.lessonNumber ?? entry.lessonNumber,
		hour: entry.hour,
		rodzaj: detail?.rodzaj ?? null,
		room: detail?.room ?? null,
		addedAt: detail?.addedAt ?? null,
	};
}

function diffFields(before: CalendarSnapshot, after: CalendarSnapshot): string[] {
	return (Object.keys(after) as (keyof CalendarSnapshot)[]).filter(
		(field) => before[field] !== after[field],
	);
}

function routeOf(key: string): string | null {
	const route = key.slice(0, key.indexOf('/'));
	return route === 'szczegoly' || route === 'szczegoly_wolne' ? route : null;
}

/**
 * An entry with no detail link has no stable identity, so an edit looks like a
 * disappearance plus an appearance. When exactly one of each falls on the same date in
 * one poll, report a change. A real deletion and a real addition on that date collapse
 * into one reported change; that is the accepted cost of having no identifier.
 */
function pairSynthetic(changes: CalendarChange[]): CalendarChange[] {
	const byDate = new Map<string, { added: CalendarChange[]; removed: CalendarChange[] }>();
	for (const change of changes) {
		if (!change.key.startsWith('hash/')) continue;
		if (change.changeType !== 'new' && change.changeType !== 'removed') continue;
		const bucket = byDate.get(change.event.date) ?? { added: [], removed: [] };
		if (change.changeType === 'new') bucket.added.push(change);
		else bucket.removed.push(change);
		byDate.set(change.event.date, bucket);
	}
	const dropped = new Set<CalendarChange>();
	for (const bucket of byDate.values()) {
		if (bucket.added.length !== 1 || bucket.removed.length !== 1) continue;
		const [added] = bucket.added;
		const [removed] = bucket.removed;
		added.changeType = 'changed';
		added.previous = removed.event;
		added.changedFields = diffFields(removed.event, added.event);
		dropped.add(removed);
	}
	return changes.filter((change) => !dropped.has(change));
}

export function commitCalendarPoll(
	state: IDataObject,
	account: string,
	plan: CalendarPlan,
	details: Map<string, CalendarDetail | null>,
): { aborted: boolean; changes: CalendarChange[] } {
	// Hydration awaited between planning and here, so re-check what we compared against.
	const current = state.librusCalendar as Record<string, unknown> | undefined;
	const rev = current === undefined ? 0 : current.rev;
	const owner = current === undefined ? account : current.account;
	if (rev !== plan.rev || owner !== account) return { aborted: true, changes: [] };

	const resolved = new Set([...plan.added, ...plan.changed].filter((key) => details.has(key)));
	const deferred = new Set(
		[...plan.added, ...plan.changed].filter((key) => !resolved.has(key)),
	);
	const removedKeys = new Set(plan.removed);
	const events: Record<string, StoredEvent> = {};
	for (const [key, record] of Object.entries(plan.stored)) {
		if (record.m < plan.window.from) continue; // out of the window, unobservable from now on
		if (removedKeys.has(key)) continue;
		events[key] = record; // deferred changes keep their old fingerprint and retrigger
	}
	const changes: CalendarChange[] = [];
	for (const [key, entry] of plan.entries) {
		if (deferred.has(key)) continue;
		const detail = details.get(key) ?? null;
		const before = plan.stored[key];
		const record: StoredEvent = {
			m: monthOf(entry.date),
			f: fingerprint(entry),
			s: entrySnapshot(entry, detail),
		};
		events[key] = record;
		if (plan.baseline || plan.silent.has(record.m)) continue;
		if (!before)
			changes.push({
				changeType: 'new',
				key,
				route: entry.route,
				eventId: entry.eventId,
				event: record.s,
				previous: null,
				changedFields: [],
			});
		else if (before.f !== record.f)
			changes.push({
				changeType: 'changed',
				key,
				route: entry.route,
				eventId: entry.eventId,
				event: record.s,
				previous: before.s,
				changedFields: diffFields(before.s, record.s),
			});
	}
	for (const key of plan.removed) {
		const before = plan.stored[key];
		changes.push({
			changeType: 'removed',
			key,
			route: routeOf(key),
			eventId: routeOf(key) ? key.slice(key.indexOf('/') + 1) : null,
			event: before.s,
			previous: before.s,
			changedFields: [],
		});
	}
	if (Object.keys(events).length > MAX_EVENTS) throw new LibrusError('CALENDAR_STATE_LIMIT');
	state.librusCalendar = {
		version: 1,
		rev: plan.rev + 1,
		account,
		window: { from: plan.window.from, monthsAhead: plan.window.monthsAhead },
		events,
	};
	return { aborted: false, changes: pairSynthetic(changes) };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add nodes/Librus/calendarState.ts tests/calendarState.test.cjs
git commit -m "Commit Librus calendar polls with partial hydration and a race guard"
```

---

### Task 8: Trigger node — three events

**Files:**
- Modify: `nodes/Librus/LibrusTrigger.node.ts`
- Test: `tests/trigger.test.cjs`

**Interfaces:**
- Consumes: `getCalendar` (Tasks 4-5), `monthWindow`, `planCalendarPoll`, `commitCalendarPoll`, `entrySnapshot`, `CalendarChange` (Tasks 6-7), the existing `accountKey` and `selectNewMessages`.
- Produces: node parameters `event` (`newMessage` | `newCalendarEvent` | `changedCalendarEvent`), `monthsAhead`, `eventTypes`; and the emitted item shape.

- [ ] **Step 1: Write the failing tests**

```js
// append to tests/trigger.test.cjs
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
	assert.equal(await trigger.poll.call(calendarContext(state, 'newCalendarEvent')), null);
	restore();
	restore = stubCalendar(
		[calendarEntry('szczegoly/1', '2026-09-18'), calendarEntry('szczegoly/2', '2026-09-20')],
		new Map([['szczegoly/2', calendarDetail('Kartkówka')]]),
	);
	const result = await trigger.poll.call(calendarContext(state, 'newCalendarEvent'));
	restore();
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
	await trigger.poll.call(calendarContext(state, 'changedCalendarEvent'));
	restore();
	restore = stubCalendar(
		[calendarEntry('szczegoly/1', '2026-09-25'), calendarEntry('szczegoly/3', '2026-09-27')],
		new Map([['szczegoly/1', calendarDetail('Sprawdzian')], ['szczegoly/3', calendarDetail('Wycieczka')]]),
	);
	const result = await trigger.poll.call(calendarContext(state, 'changedCalendarEvent'));
	restore();
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
	await trigger.poll.call(calendarContext(state, 'newCalendarEvent'));
	restore();
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
	const result = await trigger.poll.call(
		calendarContext(state, 'newCalendarEvent', { eventTypes: ' SPRAWDZIAN , kartkówka ' }),
	);
	restore();
	assert.deepEqual(
		result[0].map((item) => item.json.eventKey).sort(),
		['szczegoly/1', 'szczegoly/3'],
	);
});

test('a manual test returns a bounded sample and never touches history', async () => {
	const state = {};
	const trigger = new LibrusTrigger();
	const entries = Array.from({ length: 9 }, (_, i) =>
		calendarEntry(`szczegoly/${i}`, '2026-09-18'),
	);
	const restore = stubCalendar(entries, new Map());
	const result = await trigger.poll.call(
		calendarContext(state, 'newCalendarEvent', {}, true),
	);
	restore();
	assert.equal(result[0].length, 5);
	assert.equal(result[0][0].json.changeType, 'sample');
	assert.deepEqual(state, {});
});

test('the message event keeps its existing behaviour and its own state key', async () => {
	const state = { librusCalendar: { version: 1, rev: 3, account, window: { from: '2026-09', monthsAhead: 1 }, events: {} } };
	assert.deepEqual(selectNewMessages(state, account, [message('a')]), []);
	assert.equal(state.librus.seenIds.length, 1);
	assert.equal(state.librusCalendar.rev, 3);
});
```


- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — the `event` property has no `options` array with three values.

- [ ] **Step 3: Rewrite the node description**

```ts
	description: INodeTypeDescription = {
		displayName: 'Librus Trigger',
		name: 'librusTrigger',
		icon: 'file:librus.png',
		group: ['trigger'],
		version: 1,
		description:
			'Uruchamiaj workflow po otrzymaniu nowej wiadomości albo po dodaniu lub zmianie wydarzenia w terminarzu Librus Synergia',
		defaults: { name: 'Librus — wyzwalacz' },
		polling: true,
		eventTriggerDescription: 'Po wykryciu nowej wiadomości lub zmiany w terminarzu Librus Synergia',
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'librusSessionApi', required: true, testedBy: 'librusConnectionTest' }],
		properties: [
			{
				displayName: 'Event',
				name: 'event',
				type: 'options',
				noDataExpression: true,
				default: 'newMessage',
				options: [
					{
						name: 'Nowa wiadomość',
						value: 'newMessage',
						action: 'Nowa wiadomość',
						description: 'Uruchom po otrzymaniu nowej wiadomości w skrzynce',
					},
					{
						name: 'Nowe wydarzenie w terminarzu',
						value: 'newCalendarEvent',
						action: 'Nowe wydarzenie w terminarzu',
						description: 'Uruchom po dodaniu wydarzenia do terminarza',
					},
					{
						name: 'Zmiana wydarzenia w terminarzu',
						value: 'changedCalendarEvent',
						action: 'Zmiana wydarzenia w terminarzu',
						description:
							'Uruchom po zmianie, przeniesieniu lub zniknięciu wydarzenia z terminarza',
					},
				],
			},
			// ... the existing baselineNotice, maxPages and includePreview entries, each gaining:
			//     displayOptions: { show: { event: ['newMessage'] } }
			{
				displayName:
					'Pierwsze automatyczne sprawdzenie zapamiętuje obecny terminarz bez uruchamiania workflow dla istniejących wydarzeń. Test ręczny zwraca do pięciu wydarzeń z bieżącego miesiąca i nie zmienia historii. Ustaw harmonogram (Poll Times) na co najmniej 15 minut.',
				name: 'calendarBaselineNotice',
				type: 'notice',
				default: '',
				displayOptions: { show: { event: ['newCalendarEvent', 'changedCalendarEvent'] } },
			},
			{
				displayName: 'Liczba miesięcy wprzód',
				name: 'monthsAhead',
				type: 'number',
				default: 1,
				typeOptions: { minValue: 0, maxValue: 6 },
				displayOptions: { show: { event: ['newCalendarEvent', 'changedCalendarEvent'] } },
				description:
					'Ile miesięcy po bieżącym sprawdzać. Każdy miesiąc to jedno dodatkowe zapytanie, a wydarzeń spoza tego zakresu nie wykryjemy.',
			},
			{
				displayName: 'Rodzaje wydarzeń',
				name: 'eventTypes',
				type: 'string',
				default: '',
				placeholder: 'Sprawdzian, Kartkówka',
				displayOptions: { show: { event: ['newCalendarEvent', 'changedCalendarEvent'] } },
				description:
					'Lista rodzajów po przecinku, dopasowywana bez rozróżniania wielkości liter. Puste pole przepuszcza wszystkie wydarzenia. Wydarzenia o nieznanym rodzaju są zawsze przepuszczane, żeby nie zgubić odwołanego wydarzenia.',
			},
		],
	};
```

- [ ] **Step 4: Implement the poll dispatch**

```ts
import {
	commitCalendarPoll,
	entrySnapshot,
	monthWindow,
	planCalendarPoll,
	type CalendarChange,
	type CalendarPlan,
} from './calendarState';

function parseTypes(value: string): string[] {
	return (typeof value === 'string' ? value : '')
		.split(',')
		.map((type) => type.trim().toLocaleLowerCase('pl'))
		.filter((type) => type);
}
/** An unknown kind always passes: a missed cancellation is worse than one extra item. */
function matchesType(types: string[], rodzaj: string | null): boolean {
	if (!types.length || !rodzaj) return true;
	return types.includes(rodzaj.trim().toLocaleLowerCase('pl'));
}

async function pollCalendar(
	context: IPollFunctions,
	client: LibrusClient,
	manual: boolean,
	account: string,
	event: 'newCalendarEvent' | 'changedCalendarEvent',
): Promise<INodeExecutionData[][] | null> {
	const types = parseTypes(context.getNodeParameter('eventTypes') as string);
	if (manual) {
		const window = monthWindow(new Date(), 0);
		const scan = await client.getCalendar({ months: window.months }, (entries) =>
			entries.slice(0, 5).map((entry) => entry.key),
		);
		const items = scan.entries.slice(0, 5).map((entry) => {
			const detail = scan.details.get(entry.key) ?? null;
			return {
				json: {
					changeType: 'sample',
					eventKey: entry.key,
					eventId: entry.eventId,
					route: entry.route,
					...entrySnapshot(entry, detail),
					changedFields: [],
					previous: null,
					details: detail?.fields ?? null,
				},
			};
		});
		return items.length ? [items] : null;
	}
	const window = monthWindow(new Date(), context.getNodeParameter('monthsAhead') as number);
	const state = context.getWorkflowStaticData('node');
	let plan: CalendarPlan | undefined;
	const scan = await client.getCalendar({ months: window.months }, (entries) => {
		plan = planCalendarPoll(state, account, window, entries);
		return plan.hydrate;
	});
	if (plan === undefined) throw new LibrusError('PROTOCOL_ERROR');
	const { aborted, changes } = commitCalendarPoll(state, account, plan, scan.details);
	if (aborted) return null;
	const wanted: CalendarChange['changeType'][] =
		event === 'newCalendarEvent' ? ['new'] : ['changed', 'removed'];
	const items = changes
		.filter(
			(change) =>
				wanted.includes(change.changeType) && matchesType(types, change.event.rodzaj),
		)
		.map((change) => ({
			json: {
				changeType: change.changeType,
				eventKey: change.key,
				eventId: change.eventId,
				route: change.route,
				...change.event,
				changedFields: change.changedFields,
				previous: change.previous,
				details: scan.details.get(change.key)?.fields ?? null,
			},
		}));
	return items.length ? [items] : null;
}
```

In `poll`, keep the existing message path verbatim and branch before it:

```ts
			const event = this.getNodeParameter('event');
			// ... credentials and client construction unchanged ...
			const manual = this.getMode() === 'manual';
			const account = accountKey(
				credentials.username,
				this.getNode().credentials?.librusSessionApi?.id ?? '',
			);
			if (event === 'newCalendarEvent' || event === 'changedCalendarEvent')
				return await pollCalendar(this, client, manual, account, event);
			if (event !== 'newMessage') throw new LibrusError('INVALID_OPTIONS');
			// ... existing message scan unchanged, reusing `account` ...
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm run check`
Expected: PASS, including every pre-existing message-trigger test — those exercise the default `newMessage` path and must not need edits.

- [ ] **Step 6: Commit**

```bash
git add nodes/Librus/LibrusTrigger.node.ts tests/trigger.test.cjs
git commit -m "Add calendar added and changed events to the Librus trigger"
```

---

### Task 9: Documentation and release

**Files:**
- Modify: `docs/architecture.md`, `docs/live-verification.md`, `README.md`, `CHANGELOG.md`, `package.json`, `package-lock.json`

**Interfaces:**
- Consumes: everything above. Produces no code.

- [ ] **Step 1: Extend `docs/architecture.md`**

Add a `## Calendar protocol and polling contract` section stating, in the existing evidence-first voice: the POST month form and its credential-free allowlist entry; the detail routes; that `/terminarz/dodane_od_ostatniego_logowania` is rejected because it is consumed on view; the day-grid completeness guard and why a mis-dated event is worse than an outage; fingerprints computed from grid text so sub-field extraction cannot cause false changes; partial commit and its `ceil(n/50)` convergence; the resolved-versus-unresolved hydration rule; the revision guard around the awaited hydration; window pruning, silent baselining when the span grows, and that a natural advance still emits; the synthetic-key pairing heuristic and its documented failure mode; and that unknown `rodzaj` passes the filter. State plainly that none of it is live-verified.

- [ ] **Step 2: Extend `docs/live-verification.md`**

Add a `## Calendar trigger acceptance` list:

1. Confirm the month form: POST `rok`/`miesiac` returns the requested month, and that the grid renders every day of that month with no adjacent-month days. A `numery dni miesiąca` failure means the assumption is wrong — record the shape, do not paste private content.
2. Record the real `Rodzaj` vocabulary from the emitted output so the free-text filter can become a multi-select later.
3. Open a `szczegoly_wolne` entry and confirm its detail page parses; note whether it redirects.
4. Confirm the first automatic poll emits nothing, a newly added event emits once, an edited description and a moved date each emit one change, and a removed event emits one removal.
5. Restart the instance with persistent storage and confirm no replay.
6. Confirm calendar polling does not disturb the Librus web UI, and that the message trigger on the same account is unaffected.
7. Measure a safe poll interval before unattended use; 15 minutes or slower is the starting point.

- [ ] **Step 3: Extend `README.md`**

Document the two new events in Polish beside the existing message event: what each emits, the `Liczba miesięcy wprzód` and `Rodzaje wydarzeń` parameters, the silent first poll, that removals arrive on the change event, and that the type filter passes unknown kinds.

- [ ] **Step 4: Bump the version and write the changelog**

```bash
npm version 0.2.0 --no-git-tag-version
```

Add a `## 0.2.0 — 2026-09-12` entry to `CHANGELOG.md` in the existing style: new calendar added/changed events on the shared trigger; month scanning through a credential-free POST target; detail hydration only for new or changed entries with partial commit; discovery history for the calendar under its own state key; the day-grid guard; the free-text kind filter; message behaviour and `newMessage` defaults unchanged.

- [ ] **Step 5: Verify the package**

Run: `npm run check && npm pack --dry-run`
Expected: lint and build clean, every test passing, and the archive listing `dist/nodes/Librus/terminarz.js`, `dist/nodes/Librus/calendarState.js` and `dist/nodes/Librus/errors.js`.

- [ ] **Step 6: Commit**

```bash
git add docs README.md CHANGELOG.md package.json package-lock.json
git commit -m "v0.2.0: document and release the Librus calendar trigger"
```
