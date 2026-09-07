# Bootstrap verification — 2026-09-07

- Node.js 24.20.0, TypeScript 5.9.2, @n8n/node-cli 0.46.4, n8n-workflow development types 2.38.1.
- `npm run check`: clean lint and TypeScript build; 35 synthetic offline tests passed.
- Tests cover authentication, host-scoped cookies, unsafe redirects, password POST replay prevention, bounded pagination, deduplication, expiry retry, marked login pages, optional fields, base64/UTF-8 validation, safe timeouts and sanitized n8n execution/credential-test errors.
- Official CLI development mode started n8n 2.37.10 on loopback port 5689 with a separate temporary profile. `/healthz` returned HTTP 200. The generated n8n node and credential registries contained `CUSTOM.librus` and `librusSessionApi`. No user account setup, workflow activation or real Librus login was performed.
- `npm pack` produced an installable tarball; the manifest entry points, icons and documentation were inspected. Tests, node_modules, development profiles and compiler caches are excluded.
- One independent GPT-5.6 Sol reader reviewed the client, adapters, credentials and protocol sources. Optional-field, timeout-boundary and login-form classification findings were addressed and covered by regression tests.
- Runtime audit: zero reported vulnerabilities. Development tooling: ten moderate advisories remain after updating n8n-workflow to remove the initial four high-severity reports; see SECURITY.md.

These checks establish package loading and offline behaviour. They do not establish successful live authentication, body completeness, unread-state preservation, pagination semantics or safe unattended polling frequency.
