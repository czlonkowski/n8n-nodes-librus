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
	nbsp: String.fromCharCode(0xa0),
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
		.replace(new RegExp(String.fromCharCode(0xa0), 'g'), ' ')
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
