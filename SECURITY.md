# Security

Do not submit real credentials, cookies, message contents, student names or account identifiers in public issues or test fixtures. Use synthetic examples. Until a public security-reporting channel is established, contact the maintainer privately through an existing trusted channel.

This package logs into Librus using the user's credentials stored in n8n. Protect the instance encryption key and backups. Metadata and optional body content are normal workflow output: configure execution retention accordingly.

The client validates redirect destinations and scopes cookies per URL; it never logs requests or raw response bodies. Errors are fixed, sanitized messages. Transport, response validation and node-boundary redaction have offline tests. This does not replace live compatibility checks.

The production dependency audit reported zero known vulnerabilities when bootstrapped on 2026-09-07. The official development-tool dependency tree reported 10 moderate advisories after updating the development n8n-workflow dependency to 2.38.1, including transitive LangChain-related packages; these are not shipped as this package's runtime dependencies. Recheck with `npm audit` and `npm audit --omit=dev` before release. No automatic force-upgrade was applied across the pinned n8n toolchain.

Full Message is an explicit opt-in because reading message details may mark messages as read in Librus. Its 50-message cap is checked before detail requests. A later error suppresses partial node output but cannot undo any unread-state changes caused by earlier detail requests.

Manual publication uses an inspected archive with explicit allowed paths. The release script rejects environment files, npm authentication configuration, n8n profiles, common private-key files and databases even if nested inside a permitted directory. The credential class shipped in the package defines empty, masked input fields; it does not contain a user's saved credentials.

On 2026-09-07, Gitleaks 8.30.1 scanned all 8 existing Git commits and the actual 29-file npm archive with full redaction enabled: no secrets were detected. The browser-session client was also reviewed for password destinations, per-URL cookie scoping and sanitized error output. Pattern scanning is supporting evidence, not a guarantee against every possible secret format. The private n8n profile and its credential values were not read for this audit.
