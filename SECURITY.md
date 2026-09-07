# Security

Do not submit real credentials, cookies, message contents, student names or account identifiers in public issues or test fixtures. Use synthetic examples. Until a public security-reporting channel is established, contact the maintainer privately through an existing trusted channel.

This package logs into Librus using the user's credentials stored in n8n. Protect the instance encryption key and backups. Metadata and optional body content are normal workflow output: configure execution retention accordingly.

The client validates redirect destinations and scopes cookies per URL; it never logs requests or raw response bodies. Errors are fixed, sanitized messages. Transport, response validation and node-boundary redaction have offline tests. This does not replace live compatibility checks.

The production dependency audit reported zero known vulnerabilities when bootstrapped on 2026-09-07. The official development-tool dependency tree reported 10 moderate advisories after updating the development n8n-workflow dependency to 2.38.1, including transitive LangChain-related packages; these are not shipped as this package's runtime dependencies. Recheck with `npm audit` and `npm audit --omit=dev` before release. No automatic force-upgrade was applied across the pinned n8n toolchain.

Full Message is an explicit opt-in because reading message details may mark messages as read in Librus. Its 50-message cap is checked before detail requests. A later error suppresses partial node output but cannot undo any unread-state changes caused by earlier detail requests.
