# Changelog

## 0.1.0 — Unreleased

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
