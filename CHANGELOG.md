# Changelog

## 0.2.0 — 2026-09-12

- Add two calendar events, Nowe wydarzenie w terminarzu and Zmiana wydarzenia w terminarzu, to the shared Librus Trigger node; removals and cancellations are reported on the change event, not a separate one.
- Scan the current month plus a configurable number of months ahead through a credential-free POST to the Librus terminarz month form, guarded by a day-grid completeness check so a malformed or mis-rendered grid fails the poll instead of silently mis-dating or dropping events.
- Fetch event detail pages only for new or changed entries, hydrating up to 50 per poll and deferring the remainder to later polls without failing or losing already-detected changes.
- Record calendar discovery history under its own librusCalendar state key, separate from the existing message history, with an independent silent baseline, window pruning and account-change reset.
- Add a free-text, case-insensitive event-kind filter that always passes an unknown kind, so an unrecognized or not-yet-hydrated event type is never silently dropped.
- Leave message behaviour, the newMessage event and its defaults unchanged for existing workflows.
- Bound each day block of the month grid to its own element, so a page legend or footer after the grid is no longer read as events dated to the last day of the month, and a footer that changes between polls no longer emits a phantom change every poll; an unbalanced grid fails the poll instead.
- Fix calendar polling aborting silently and permanently after a credential or username change: the concurrency guard now compares the stored owner against the owner seen when the poll was planned, so an account change commits its silent baseline and the next poll emits again.
- Give each calendar attempt its own request budget so a session expiry late in detail hydration can still complete its single retry, and report an exhausted calendar scan with its own message pointing at Liczba miesięcy do przodu instead of the inbox page limit.
- Silence only the months a larger window actually added, so months that the passage of time had already brought into range still emit instead of being baselined away.
- Skip entries with no detail link before applying the 50-page hydration budget, so a real backlog of linked events drains faster.
- Reject stored calendar records whose month is malformed, which would otherwise be neither prunable nor removable.
- Reject a calendar detail response whose final address is not the requested event page, so a redirect to another Synergia page can no longer be parsed as event details.
- Stop detail hydration on the remaining request budget instead of failing the whole poll, so redirected detail pages leave a partial, committed scan that the next poll finishes rather than a backlog retried forever.
- Report invalid calendar settings with their own message naming Liczba miesięcy do przodu instead of the message-fetching settings, which the calendar events do not have.
- Rename the parameter label to Liczba miesięcy do przodu, fall back to Nowa wiadomość in the node subtitle for an unexpected event value, and keep internal planning documents out of the published npm package.
- Describe both message and calendar automation in the package description.
- Fix calendar state pruning keeping records for months beyond a shrunk window indefinitely: prune against the exact set of scanned months instead of only the window's start.

## 0.1.5 — 2026-09-08

- Add the author’s standard AiAdvisors automation services CTA in Polish to the README.

## 0.1.4 — 2026-09-08

- Describe both message retrieval and new-message detection on the shared Librus card in n8n.
- Translate node labels, actions, hints, credentials and safe error messages into Polish; update README labels to match.
- Preserve node type names, parameter keys, operation values, output fields and error codes for existing workflows.

## 0.1.3 — 2026-09-08

- Fix full inbox scans and trigger activation failing on tagged messages: accept Librus tag objects with an id field and normalize IDs to the existing string-array output.
- Preserve string tags and reject malformed tag objects or unsafe numeric IDs; never copy additional object properties to output.
- Add regression coverage for tagged messages beyond the manual sample and automatic trigger baseline/new-message detection.

## 0.1.2 — 2026-09-08

- Diagnose protocol failures with fixed validation labels, primitive type names and inbox page/item positions, without response values, message IDs or credentials.
- Distinguish authentication failures from inbox scan failures while preserving strict validation and trigger history on failed scans.

## 0.1.1 — 2026-09-08

- Fix credential connection tests failing with PROTOCOL_ERROR on empty HTTP redirects returned by n8n's legacy request helper.
- Normalize missing response bodies without accepting malformed JSON or exposing request metadata.
- Add regression coverage for the complete credential login flow and invalid inbox responses.
- Simplify the Polish README around community node installation and usage; move development and release instructions to docs/development.md.

## 0.1.0 — 2026-09-07

- Scaffold an MIT-licensed, unofficial self-hosted n8n community node.
- Add browser-session credentials and a credential connection test.
- Add Message → Get Many with bounded pagination and optional decoded content.
- Validate redirects, isolate cookies, sanitize errors and bound session recovery.
- Add synthetic transport, pagination and n8n boundary tests.
- Document unverified live behaviours and the notification workflow roadmap.
- Add an original book-and-message logo with a coral unread indicator.
- Keep the development profile outside the repository to prevent recursive symlink scans.
- Accept the successful Synergia OAuth callback and include redacted authentication-stage diagnostics in verification errors.
- Upgrade legacy HTTP redirects to HTTPS for exact trusted Librus hosts before sending any request.
- Add explicit Preview / Full Message content selection and identify the selected source in output.
- Fetch full message bodies after list selection, with a 50-message cap and strict detail validation.
- Add All / Unread / Read filtering before result limits and full-content requests.
- Add Get Content by message ID with bounded authentication recovery.
- Add Librus Trigger with silent initial baseline, manual sample, account-scoped bounded ID history and preview-only polling.
- Preserve unread selections during full-body session recovery to avoid dropping messages whose detail reads changed their status.
- Document polling, cursor persistence, downstream retry semantics and unsupported mark-unread operations in Polish.
- Use the public npm scope @czlonkowski/n8n-nodes-librus to avoid the previous unrelated unscoped package.
- Add a manual release script with a dry run, checks, archive inspection and authenticated public publishing.
