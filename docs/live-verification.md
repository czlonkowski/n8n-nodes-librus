# Live verification checklist

Status: **not yet performed**. Never paste a password or raw message response into a bug report, fixture or terminal command.

1. With Node.js 24 active, run `N8N_LISTEN_ADDRESS=127.0.0.1 N8N_PORT=5689 npm run dev`. The isolated profile lives in `../.n8n-librus-dev`; never put it inside this repository. Create credentials inside the n8n UI.
2. Run the credential test. Record only success or the sanitized error code. Confirm the login works on accounts with and without optional verification prompts; stop when the website requires user action.
3. Note the IDs and unread status of a small known set in the Librus UI. Execute Get Many with Limit 10 and Include Content off. Compare sender, subject, ID and dates without saving a private fixture.
4. Reopen the website and verify unread status is unchanged. This must pass before claiming that polling preserves unread state.
5. Enable Include Content for a known message and compare the complete body, Unicode and HTML with the UI. Test a message with an attachment; verify attachment presence only. Confirm whether base64 padding and nullable fields match the strict schema.
6. Test a second page and end-of-list behaviour. Verify the server honours `limit` and whether short pages always mean the end. Test duplicate IDs and arrival of a new message between scans.
7. Use controlled synthetic transport tests for expiry and 429; do not deliberately hammer a live account or repeatedly submit wrong passwords.
8. Before unattended scheduling, measure ordinary session lifetime, login effects on the browser/mobile app, practical polling frequency and concurrent account behaviour. Build durable ID deduplication and an initial baseline. Add a workflow error path for authentication failures and incomplete scans.

Do not store cookies in workflow static data or node output when adding session reuse. Do not label sessions as OAuth refresh tokens without observing and verifying a supported refresh operation.
