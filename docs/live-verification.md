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
