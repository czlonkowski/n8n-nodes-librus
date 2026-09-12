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
