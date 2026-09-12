import { createHash } from 'node:crypto';
import type { IDataObject } from 'n8n-workflow';
import { LibrusError } from './errors';
import type { CalendarDetail, CalendarEntry } from './terminarz';

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
	/** Account fingerprint stored when the plan was made, or the current one if nothing was. */
	owner: string;
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

const MONTH_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])$/;

function validWindow(value: unknown): boolean {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
	const window = value as Record<string, unknown>;
	return (
		typeof window.from === 'string' &&
		MONTH_PATTERN.test(window.from) &&
		Number.isInteger(window.monthsAhead) &&
		(window.monthsAhead as number) >= 0 &&
		(window.monthsAhead as number) <= 6
	);
}

const DATE_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;

/** Snapshot fields declared `string | null` in CalendarSnapshot. */
const NULLABLE_STRINGS = [
	'subject',
	'teacher',
	'description',
	'hour',
	'rodzaj',
	'room',
	'addedAt',
] as const;

/**
 * Every field of the stored snapshot, checked against its declared type. Later code
 * consumes these as the types `CalendarSnapshot` promises — the trigger's type filter
 * calls `rodzaj.trim()` while emitting a removal, for one — so a record that is merely
 * shaped like a snapshot would turn corrupt state into an unhandled TypeError inside an
 * unattended poll instead of the CALENDAR_STATE_INVALID this module owes the user.
 */
function validSnapshot(value: unknown): boolean {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
	const snapshot = value as Record<string, unknown>;
	if (typeof snapshot.date !== 'string' || !DATE_PATTERN.test(snapshot.date)) return false;
	if (typeof snapshot.text !== 'string') return false;
	for (const field of NULLABLE_STRINGS)
		if (snapshot[field] !== null && typeof snapshot[field] !== 'string') return false;
	return (
		snapshot.lessonNumber === null ||
		(Number.isSafeInteger(snapshot.lessonNumber) && (snapshot.lessonNumber as number) >= 0)
	);
}

function validEvents(value: unknown): boolean {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
	const events = value as Record<string, unknown>;
	if (Object.keys(events).length > MAX_EVENTS) return false;
	return Object.values(events).every((record) => {
		if (typeof record !== 'object' || record === null || Array.isArray(record)) return false;
		const stored = record as Record<string, unknown>;
		// `m` decides both pruning and removal detection: a typed but malformed month
		// would leave a record neither prunable nor removable, so it is rejected here.
		if (
			typeof stored.m !== 'string' ||
			!MONTH_PATTERN.test(stored.m) ||
			typeof stored.f !== 'string' ||
			!stored.f
		)
			return false;
		return validSnapshot(stored.s);
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
	let owner = account;
	let baseline = true;
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
		owner = previous.account as string;
		if (previous.account === account) {
			stored = { ...(previous.events as Record<string, StoredEvent>) };
			baseline = false;
			storedAhead = (previous.window as { monthsAhead: number }).monthsAhead;
		}
	}
	// Months that appear only because the configured span grew were never observable
	// before, so they are recorded without emitting. A window advancing with time is
	// ordinary discovery and still emits — so the silent set is measured against the
	// horizon the *current* start month would have reached under the *old* span, not
	// against the horizon stored at the last poll. Using the stored horizon would also
	// silence months that plain time-advance had already brought in, losing real
	// notifications whenever a span change and a month boundary land between two polls.
	const silent = new Set<string>();
	if (!baseline && storedAhead >= 0 && window.monthsAhead > storedAhead) {
		const grown = addMonths(window.from, storedAhead);
		for (const month of window.months) if (month > grown) silent.add(month);
	}
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
	return {
		rev,
		owner,
		baseline,
		window,
		silent,
		entries: map,
		stored,
		added,
		changed,
		removed,
		hydrate,
	};
}

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
	// The guard detects a concurrent write, not a change of account: it compares the
	// stored owner against the owner observed at plan time. Comparing it against the
	// *new* account would make every poll after a credential change abort forever,
	// silently, because the stored owner is by definition the old one.
	const current = state.librusCalendar as Record<string, unknown> | undefined;
	const rev = current === undefined ? 0 : current.rev;
	const owner = current === undefined ? plan.owner : current.account;
	if (rev !== plan.rev || owner !== plan.owner) return { aborted: true, changes: [] };

	const candidates = new Set([...plan.added, ...plan.changed]);
	const removedKeys = new Set(plan.removed);
	const events: Record<string, StoredEvent> = {};
	for (const [key, record] of Object.entries(plan.stored)) {
		if (record.m < plan.window.from) continue; // out of the window, unobservable from now on
		if (removedKeys.has(key)) continue;
		events[key] = record; // untouched: unchanged entries and deferred changes keep their old record
	}
	const changes: CalendarChange[] = [];
	for (const [key, entry] of plan.entries) {
		const month = monthOf(entry.date);
		const isSilent = plan.silent.has(month);
		if (!plan.baseline && !isSilent) {
			if (!candidates.has(key)) continue; // unchanged; the copy above already carried it over
			if (!details.has(key)) continue; // unresolved hydration; deferred, keeps the old record
		}
		const detail = details.get(key) ?? null;
		const before = plan.stored[key];
		const record: StoredEvent = {
			m: month,
			f: fingerprint(entry),
			s: entrySnapshot(entry, detail),
		};
		events[key] = record;
		if (plan.baseline || isSilent) continue;
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
