# Changelog

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
