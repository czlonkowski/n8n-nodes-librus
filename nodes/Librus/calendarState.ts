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
