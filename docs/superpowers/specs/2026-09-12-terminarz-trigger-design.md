# Calendar (terminarz) trigger — design

Date: 2026-09-12. Status: approved for planning. Scope: two new polling events on the existing Librus Trigger node — a calendar event was added, and a calendar event changed.

## Goal

Librus Synergia publishes school events (tests, quizzes, trips, teacher absences, free days, parent meetings) in a monthly calendar at `https://synergia.librus.pl/terminarz`. Workflows need to react when an event appears and when an existing event is edited, moved to another date, or disappears. Detection quality matters more than freshness: a silently mis-dated test is worse than a late notification, and a missed cancellation is worse than one redundant item.

## Settled requirements

- All calendar entry kinds are in scope, with an optional type filter.
- "Changed" covers edits to tracked fields, date moves, and disappearance from the calendar.
- Scan window is the current month plus N months ahead (default 1, range 0-6). No months backwards.
- Detail pages are fetched only for entries that are new or whose grid fingerprint changed.
- Both events live on the existing `librusTrigger` node, which keeps `version: 1`.

## Observed protocol

Unverified community observations (RustySnek/librus-apix, Mati365/librus-api); no live run has been performed by the implementer.

1. POST `https://synergia.librus.pl/terminarz` with form fields `rok` and `miesiac` returns the month grid as HTML. There is no JSON equivalent.
2. Each day is a `div.kalendarz-dzien` containing `div.kalendarz-numer-dnia` with the day number, and rows whose `td` carries `onclick="...'/terminarz/szczegoly/<id>'"` and `title="Nauczyciel: ...<br />Opis: ..."`.
3. `GET /terminarz/szczegoly/<id>` returns a `th`/`td` detail table: Data, Nr lekcji, Nauczyciel, Rodzaj, Przedmiot, Sala, Opis, Data dodania. Teacher absences use `/terminarz/szczegoly_wolne/<id>`.
4. `/terminarz/dodane_od_ostatniego_logowania` lists entries added since the last login but is consumed on view. It is rejected as a trigger source; discovery history is owned by this package, as it already is for messages.

## Modules

- `nodes/Librus/terminarz.ts` — pure parser, no network: `parseMonth(html, year, month)` and `parseEventDetail(html)`. Fully covered by HTML fixtures.
- `nodes/Librus/LibrusClient.ts` — `getCalendar(options)`, private `monthPage(year, month)` and `eventDetail(route, id)`; the credential-free POST allowlist; existing single session-recovery behaviour.
- `nodes/Librus/calendarState.ts` — `selectCalendarChanges(...)`, mirroring `pollState.ts`: versioned state, hard limits, no silent recovery from corrupt state.
- `nodes/Librus/LibrusTrigger.node.ts` — `event` becomes a visible option list with three values; message and calendar parameters are separated by `displayOptions`. Existing workflows stay on `newMessage`.

## Transport boundary

The month grid needs a POST, which the client currently rejects outside the OAuth route. A second, separate allowlist holds exactly one credential-free POST target: `https://synergia.librus.pl/terminarz`. Its body is built solely from validated integers (`rok` 2000-2100, `miesiac` 1-12); no free text and no credential ever reaches it. The existing rules stay in force: a POST is never automatically redirected and never replayed. A POST redirect whose Location points at `/loguj` or the OAuth host maps to `SESSION_EXPIRED` instead of today's opaque protocol error.

Detail routes are restricted to `szczegoly` and `szczegoly_wolne`, with numeric-only event IDs, before any URL is built.

## Poll flow

1. Authenticate (unchanged).
2. POST one request per month in the window, oldest first.
3. Parse each month into entries and compute a fingerprint per entry from grid fields.
4. Read state, compute the full diff (added / changed / removed) synchronously.
5. Hydrate detail pages for added and changed entries, in ascending lexicographic key order, at most 50 per poll. Removals are never hydrated and do not count against the cap.
6. Re-read state; if the account fingerprint or the revision counter changed during hydration, abort without writing and without emitting. The next poll repeats the work.
7. Write state and emit the items matching the subscribed event and the type filter.

Steady state costs two requests above login. The baseline scan performs zero detail fetches.

### Partial commit instead of a fatal cap

Exceeding 50 hydration candidates must not fail the poll. A fatal cap would livelock an unattended trigger: every poll would spend 50 requests, fail, write nothing and repeat. Instead the poll hydrates the first 50 candidates in ascending lexicographic key order and commits state for hydrated, unchanged and removed entries only. Un-hydrated candidates stay unrecorded and are picked up by the next poll. A backlog of n candidates converges in ceil(n/50) polls with no duplicate emission. Fatal errors remain reserved for protocol violations.

A 404 on a detail page means the entry disappeared between the scan and hydration: skip it, do not commit its key, let the next poll resolve it. A detail page that loads but is not a detail table is a protocol error.

## Identity and state

Key is `<route>/<id>`, because numeric IDs may repeat across entry kinds. A grid cell without an `onclick` gets a synthetic key hashed from its date and cell text.

```
state.librusCalendar = {
  version: 1,
  rev: <integer, incremented on every write>,
  account: <sha256 of [credentialId, username]>,
  window: { from: 'YYYY-MM', monthsAhead: <configured N> },
  events: { '<key>': { m: 'YYYY-MM', f: <fingerprint>, s: { <grid snapshot + rodzaj> } } },
}
```

The snapshot exists so a `changed` item can carry `previous` and `changedFields`, and so a `removed` item has a payload at all. `Rodzaj` lives only on the detail page, so it is persisted in the snapshot; otherwise the type filter could not apply to removals.

- The first complete scan is a silent baseline, as for messages.
- Entries whose month falls out of the window are pruned, bounding growth to the window. Cap: 2000 entries; reaching it fails without mutating state.
- Months that enter the window because the configured N grew are baselined silently. A window that advances naturally with time emits normally.
- Changing account establishes a new baseline.
- State is stored under `librusCalendar`, beside the existing `librus` key, and records every observed change regardless of which event the workflow subscribed to.

### Mass-removal guard

An empty month is legitimate; an empty-because-broken page is not. The parser must reconstruct the complete set of day numbers for the scanned month (1..N, no duplicates). A syntactically valid page without that grid is a protocol error, never a wholesale deletion. If Librus renders adjacent-month days inside the grid, the duplicate day number also fails deliberately: a silently mis-dated event is worse than an outage. Live verification resolves which case is real.

### Synthetic-key pairing

Exactly one disappearance and exactly one appearance of link-less entries on the same date within the same poll are reported as one `changed` item. Documented failure mode: a genuine deletion and a genuine addition on the same date collapse into a single reported change.

## Output

One item per event: `eventKey`, `eventId`, `route`, `date`, `lessonNumber`, `hour`, `subject`, `teacher`, `description`, `room`, `rodzaj` (raw), `addedAt`, `details` (raw th/td pairs), `changeType` (`new` / `changed` / `removed`), plus `changedFields` and `previous` for changes.

Manual execution scans the current month only, returns at most five entries with details and `changeType: 'sample'`, and never touches history.

## Type filter

The `Rodzaj` vocabulary is not verified, so a closed multi-select would be a guess that silently drops real events. This version ships a free-text comma-separated list (empty means everything), matched case-insensitively after `trim` and `toLocaleLowerCase('pl')`. The raw value is always emitted so the real vocabulary can be read from live output and promoted to a multi-select in a later release. Entries whose `rodzaj` is unknown — baselined without hydration, then removed — pass the filter: a missed cancellation is worse than one redundant item.

## Parsing

A hand-rolled narrow parser, no new dependency. It does not attempt to understand HTML; it extracts defined anchors (`kalendarz-dzien`, `kalendarz-numer-dnia`, the `onclick` detail path, the `title` attribute, `th`/`td` rows) and validates structure. Anything unexpected raises `PROTOCOL_ERROR` with a code-owned label; no parse failure ever degrades into an empty calendar. HTML entity and `<br />` decoding inside the `title` attribute gets dedicated fixtures.

Rationale for rejecting `cheerio`/`parse5`: the package deliberately ships one runtime dependency; added transitive trees and runtime version collisions inside n8n cost more than the robustness gained on a page whose anchors are this narrow.

## Errors

New codes with Polish messages: `CALENDAR_STATE_INVALID`, `CALENDAR_STATE_LIMIT`, plus parser validation labels. No fatal hydration-limit code exists; the partial-commit path removes the need for one. Event IDs and routes are validated before URL construction. Error messages carry only code-owned labels and primitive type names, never Librus content — the existing convention.

## Verification

Offline: HTML fixtures (populated month, empty month, cell without a link, detail page, login page instead of a grid, entity-encoded `title`), state tests (baseline, added, changed, removed, account change, window pruning, N growth, corrupt state, limits, revision race), client tests (POST only to the allowed target, no replay, redirect to `/loguj` maps to `SESSION_EXPIRED`, 404 during hydration).

Live verification cannot be performed by the implementer and is added to `docs/live-verification.md`: confirm the POST month form, the day-grid structure and any adjacent-month spill, the real `Rodzaj` vocabulary, detail-page behaviour for `szczegoly_wolne`, and that polling the calendar does not disturb the Librus UI state.

Release: version 0.2.0, CHANGELOG entry, README section, `docs/architecture.md` updated with the calendar protocol, boundaries and polling contract.

## Consultation

Claude Fable 5 reviewed this design once. It upheld the parser choice, the POST boundary, the state shape and the free-text type filter, and overturned the fatal hydration cap in favour of partial commit. Its additional requirements — the revision-counter race guard, the mass-removal guard, silent baselining of months added by a config change, persisting `rodzaj` in the snapshot, synthetic-key pairing, and separate state keys — are incorporated above.
