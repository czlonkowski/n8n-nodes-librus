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

type TerminarzCheck =
	| 'siatka terminarza'
	| 'numery dni miesiąca'
	| 'tabela szczegółów'
	| 'dokument HTML';
function protocolError(check: TerminarzCheck, value?: unknown): LibrusError {
	return baseProtocolError(check, value);
}

/**
 * HTML 4 Latin-1 entity names for code points 160-255, in order.
 *
 * Librus encodes the one Polish letter that Latin-1 covers as `&oacute;` and the rest
 * numerically, so without these names `ó` reaches the user as raw entity text. Generated
 * from the code points rather than written out: a literal U+00A0 is invisible in a diff,
 * and a hand-typed table of 96 accented letters cannot be reviewed by eye.
 */
const latin1 =
	'nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml'.split(
		' ',
	);
const named: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
};
for (const [index, name] of latin1.entries()) named[name] = String.fromCodePoint(160 + index);
export function decodeEntities(value: string): string {
	return value.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (match, name: string) => {
		const code = name.startsWith('#')
			? Number(name[1] === 'x' || name[1] === 'X' ? `0x${name.slice(2)}` : name.slice(1))
			: NaN;
		if (Number.isInteger(code) && code > 0 && code <= 0x10ffff) return String.fromCodePoint(code);
		// Exact first: `&Oacute;` and `&oacute;` are different letters. The lowercase
		// fallback keeps the lenient `&AMP;` spelling working as it did before.
		return named[name] ?? named[name.toLowerCase()] ?? match;
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

/**
 * The title attribute holds literal `<br />` separated `Etykieta: wartość` pairs.
 *
 * Its values are entity-encoded twice: the grid serves `kt&amp;oacute;re` where the
 * detail page of the same event serves `kt&oacute;re` for the same description. The
 * caller has already decoded the attribute once, so a value still carrying an entity
 * here is content, not markup, and needs the second pass. Without it every field that
 * only the grid supplies reaches the user as `&oacute;` — which is exactly the entries
 * that have no detail page to correct them, the free days and the parent-teacher
 * meetings.
 */
function titlePairs(title: string): Record<string, string> {
	const pairs: Record<string, string> = {};
	for (const part of title.split(/<br\s*\/?>/i)) {
		const index = part.indexOf(':');
		if (index <= 0) continue;
		pairs[part.slice(0, index).trim().toLocaleLowerCase('pl')] = decodeEntities(
			part.slice(index + 1),
		).trim();
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

/**
 * Offset of the `</div>` that closes the day block whose content starts at `start`.
 *
 * A day block owns exactly its own element. Ending it at the next block's start instead
 * would give the last day of the month everything that follows the grid — the page
 * legend, the footer, any trailing table — and every `<td>` in there would be read as an
 * entry on that date. A footer that varies between polls (a clock, a last-login stamp)
 * would then produce a synthetic removal plus a synthetic addition every single poll.
 *
 * An unbalanced document is a protocol violation, not something to recover from: a
 * truncated page must fail the poll rather than silently absorb the rest of the file.
 */
function blockEnd(html: string, start: number): number {
	const tags = /<div\b|<\/div\b/gi;
	tags.lastIndex = start;
	let depth = 1;
	for (let match = tags.exec(html); match; match = tags.exec(html)) {
		depth += match[0][1] === '/' ? -1 : 1;
		if (depth === 0) return match.index;
	}
	throw protocolError('siatka terminarza', depth);
}

export function parseMonth(html: string, year: number, month: number): CalendarEntry[] {
	if (typeof html !== 'string') throw protocolError('dokument HTML', html);
	const blocks = [...html.matchAll(/<div\b[^>]*class="[^"]*\bkalendarz-dzien\b[^"]*"[^>]*>/gi)];
	if (!blocks.length) throw protocolError('siatka terminarza', blocks.length);
	const days = new Set<number>();
	const entries: CalendarEntry[] = [];
	for (const block of blocks) {
		const start = (block.index ?? 0) + block[0].length;
		const chunk = html.slice(start, blockEnd(html, start));
		// Exactly one day number per block. Taking the first of several would silently
		// attribute the whole block's cells to it, which is the mis-dating this guard exists
		// to prevent — a second marker means this is not the grid we think it is.
		const labels = [
			...chunk.matchAll(
				/<div\b[^>]*class="[^"]*\bkalendarz-numer-dnia\b[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
			),
		];
		if (labels.length !== 1) throw protocolError('numery dni miesiąca', labels.length);
		const day = Number(text(labels[0][1]));
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
		lessonNumber: Number.isSafeInteger(lesson) && lesson >= 0 ? lesson : null,
		date: fields['Data'] ?? null,
	};
}
