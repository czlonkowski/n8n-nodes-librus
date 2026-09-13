# Live verification checklist

Status: **partially verified on 2026-09-07**. A metadata-only execution and an explicit Full Message execution succeeded on one account. The full detail body was longer than the matching preview. Unread-state preservation, broader content-format coverage and pagination remain unverified. Never paste a password or raw message response into a bug report, fixture or terminal command.

1. With Node.js 24 active, run `N8N_LISTEN_ADDRESS=127.0.0.1 N8N_PORT=5689 npm run dev`. The isolated profile lives in `../.n8n-librus-dev`; never put it inside this repository. Create credentials inside the n8n UI.
2. Run the credential test. Record only success or the sanitized error code. Confirm the login works on accounts with and without optional verification prompts; stop when the website requires user action.
3. Note the IDs and unread status of a small known set in the Librus UI. Execute Get Many with Limit 10 and Include Content off. Compare sender, subject, ID and dates without saving a private fixture.
4. Reopen the website and verify unread status is unchanged. This must pass before claiming that polling preserves unread state.
5. Enable Include Content and select Content Source → Full Message for an already-read known message and compare the complete body, Unicode and HTML with the UI. Test a message with an attachment; verify attachment presence only. Confirm whether base64 padding and nullable fields match the strict schema.
6. Test a second page and end-of-list behaviour. Verify the server honours `limit` and whether short pages always mean the end. Test duplicate IDs and arrival of a new message between scans.
7. Use controlled synthetic transport tests for expiry and 429; do not deliberately hammer a live account or repeatedly submit wrong passwords.
8. Before unattended scheduling, measure ordinary session lifetime, login effects on the browser/mobile app, practical polling frequency and concurrent account behaviour. The trigger implements ID deduplication and an initial baseline; verify persistence in the target deployment. Add a workflow error path for authentication failures and incomplete scans.

Do not store cookies in workflow static data or node output when adding session reuse. Do not label sessions as OAuth refresh tokens without observing and verifying a supported refresh operation.

## New operations and trigger acceptance

- Get Many with Read Status Unread must exclude known read messages and apply Limit to matching entries, including across pages. Compare metadata-only results before enabling full-body retrieval.
- Use Get Content on an already-read ID. Compare its body with Full Message from Get Many without exporting private content.
- Manually test Librus Trigger: one sample (or none for an empty inbox), no automatic polling or history updates.
- In a deliberately activated test workflow with no outbound action, confirm the first automatic poll emits no old messages; one newly received message emits once, even if read before polling. Do not send test messages to others without authorization.
- Restart the test instance with persistent storage; confirm no replay. Exercise downstream-failure recovery with synthetic data and execution retry.
- Check account-switch baseline, an inbox beyond the page cap, and ordinary session/browser effects before enabling unattended use.

## Calendar trigger acceptance

Observed on 2026-09-13, one account, one class, September 2026 only. A manual sample
returned four current-month entries and hydrated three detail pages.

- The grid rendered exactly the 30 days of the requested month with no adjacent-month
  days: the `numery dni miesiaca` guard did not fire. Item 1 below holds for this month;
  a month whose grid starts or ends mid-week may still differ, so re-check at a month
  boundary before trusting it generally.
- Real `Rodzaj` values seen: `Inne`, `Impreza szkolna`, `Wycieczka`. Partial: one class,
  one month. Not enough to turn the free-text filter into a multi-select.
- Detail rows seen: `Data`, `Nr lekcji`, `Nauczyciel`, `Rodzaj`, `Przedmiot`, `Opis`,
  `Data dodania`. No `Sala` row appeared, so `room` stayed null on every entry; it is
  still unknown whether any entry kind carries one.
- A `Wywiadowka` entry carried no detail link at all: no id, no route, so a synthetic
  `hash/` key, and `rodzaj`, `room` and `addedAt` permanently null. The grid itself
  supplied its teacher, description and hour. This is a second detail-less kind beyond
  the `szczegoly_wolne` free days the design anticipated, and it makes the "unknown kind
  always passes" rule in `matchesType` load-bearing rather than defensive: any non-empty
  type filter would otherwise drop every parent-teacher meeting.
- The grid encodes its title attribute twice and the entity table covered only the five
  XML names, so a description reached the user as `kt&oacute;re` where the detail page of
  the same event gave `które`. Both are fixed; re-check on a fresh account that no entity
  text survives into the output, especially on an entry with no detail page.
- Consequence of the synthetic key, not yet observed live: a detail-less entry moved to
  another date reports as a removal plus an addition rather than a change, because
  `pairSynthetic` only pairs within one date. Entries with an id move correctly.
- Still unobserved: the container markup of a real detail page (item 4), every item from
  5 onwards, and any month other than September 2026.

1. Confirm the month form: POST `rok`/`miesiac` returns the requested month, and that the grid renders every day of that month with no adjacent-month days. A `numery dni miesiąca` failure means the assumption is wrong — record the shape, do not paste private content.
2. Record the real `Rodzaj` vocabulary from the emitted output so the free-text filter can become a multi-select later.
3. Open a `szczegoly_wolne` entry and confirm its detail page parses; note whether it redirects.
4. Record the structure of a real `/terminarz/szczegoly/<id>` page: whether the detail table sits inside a `div.container-background` container, and whether any other Synergia page that can be served at that path (an error page, a notice, a redirect target) presents two `th`/`td` rows. The parser accepts any two-row `th`/`td` table anywhere in the document, and the client rejects only a response whose final URL is not the requested path. With that evidence the structural check can be tightened to the container; without it, tightening would risk a hard outage on every detail fetch. Record the shape, not the content.
5. Confirm the first automatic poll emits nothing, a newly added event emits once, an edited description and a moved date each emit one change, and a removed event emits one removal.
6. Restart the instance with persistent storage and confirm no replay.
7. Confirm calendar polling does not disturb the Librus web UI, and that the message trigger on the same account is unaffected.
8. Measure a safe poll interval before unattended use; 15 minutes or slower is the starting point.
