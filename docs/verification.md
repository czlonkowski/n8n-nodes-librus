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
