# Bootstrap verification — 2026-09-07

- Node.js 24.20.0, TypeScript 5.9.2, @n8n/node-cli 0.46.4, n8n-workflow development types 2.38.1.
- `npm run check`: clean lint and TypeScript build; 35 synthetic offline tests passed.
- Tests cover authentication, host-scoped cookies, unsafe redirects, password POST replay prevention, bounded pagination, deduplication, expiry retry, marked login pages, optional fields, base64/UTF-8 validation, safe timeouts and sanitized n8n execution/credential-test errors.
- Official CLI development mode started n8n 2.37.10 on loopback port 5689 with a separate temporary profile. `/healthz` returned HTTP 200. The generated n8n node and credential registries contained `CUSTOM.librus` and `librusSessionApi`. No user account setup, workflow activation or real Librus login was performed.
- `npm pack` produced an installable tarball; the manifest entry points, icons and documentation were inspected. Tests, node_modules, development profiles and compiler caches are excluded.
- One independent GPT-5.6 Sol reader reviewed the client, adapters, credentials and protocol sources. Optional-field, timeout-boundary and login-form classification findings were addressed and covered by regression tests.
- Runtime audit: zero reported vulnerabilities. Development tooling: ten moderate advisories remain after updating n8n-workflow to remove the initial four high-severity reports; see SECURITY.md.

These checks establish package loading and offline behaviour. They do not establish successful live authentication, body completeness, unread-state preservation, pagination semantics or safe unattended polling frequency.

## Live login correction — 2026-09-07

The user's manual n8n workflow initially returned ACTION_REQUIRED. A diagnostic retry identified the terminal page as the Synergia OAuth callback. The client had incorrectly classified every `/loguj/` path as a login prompt. Allowing the callback exposed a legacy HTTP redirect during the subsequent handoff. Trusted-host HTTP redirects are now upgraded to HTTPS before any request; all other URL checks remain in force.

After both fixes, the same workflow succeeded with Limit 1 and Include Content off. The output contained one item with messageId, senderName and readDate fields. Credentials were used through the existing n8n credential entry; no password, cookie, authorization code or message value was copied into this repository or these notes. Browser-session effects, unread-state preservation, content completeness and live pagination were not measured.

`npm run check` passed all 40 tests, including successful callback handling, failed post-callback access, retained login challenges, redacted diagnostics and HTTP-to-HTTPS redirect upgrade boundaries.

## Full content retrieval — 2026-09-07

The listing content was confirmed to be a truncated preview. Added explicit Preview/Full Message selection while retaining Preview as the default. Full Message retrieves the case-sensitive data.Message field from the message detail route, only after listing pagination, limit and deduplication complete. An explicit cap of 50 selected messages bounds extra requests.

The existing manual n8n workflow succeeded with Limit 1, Include Content enabled and Content Source set to Full Message. The chosen already-read message matched the user's example. Its preview had 95 characters; its detail body had 463 characters and began with the entire preview. Only lengths and comparison results were recorded; no message contents or identifiers were added to the repository. Unread-state side effects and comparison against the full website rendering remain unverified.

`npm run check` passed 55 tests, including backward-compatible preview behaviour, full body decoding, selection before hydration, malformed/mismatched detail responses, no partial/fallback output, safety limits and session recovery during detail retrieval.

## Read filters and polling trigger — 2026-09-07

Added All/Unread/Read filtering before result limits, Get Content by ID, and a separate registered Librus Trigger. One GPT-5.6 Sol reader traced the installed n8n 2.37.10 polling/runtime persistence contract; the parent verified the decisive activation/save and cursor-before-delivery source paths and implemented the changes.

`npm run check` passed 73 synthetic tests. New tests cover nonmatching full pages, filtered limits and hydration, invalid options, single-ID dispatch, unread selection preservation during detail-session recovery, initial silent baseline, serialized restart, read-state changes, account changes, bounded/corrupt state, manual sample isolation, failed scans, shared-state overlapping calls and duplicate risk with independent stale copies. Downstream retry semantics are established from runtime source inspection and the poll cursor contract, not a live failed-notification trial.

The development watcher reported successful builds and hot reloads. A manual browser acceptance test could not be completed after the browser automation connection detached; a fresh-tab attempt also timed out. No live unread-filter result, scheduled message-arrival event or restart persistence trial is claimed for these new features. No workflow was activated and no message or notification was sent. Existing n8n credentials were not extracted. Mark-as-unread is not implemented because the inspected public Librus frontend exposed no matching action.

## Manual npm publishing — 2026-09-07

The unscoped n8n-nodes-librus name belongs to a previous unrelated package. The manifest and lockfile now use @czlonkowski/n8n-nodes-librus at 0.1.0; the GitHub repository keeps its existing name. npm reports no public scoped package entry; authenticated publishing access still needs confirmation.

Added scripts/release.mjs and npm run release, with a --dry-run option. The actual dry run completed dependency installation, clean lint/build, all 73 tests, inspection of the 29-file archive and npm publish --dry-run with public access. No version was published. Invalid arguments and dirty-working-tree publication guards were also exercised. The script publishes the inspected tarball and does not create a release pipeline, Git tag or GitHub release. Local npm authentication was absent during verification.
