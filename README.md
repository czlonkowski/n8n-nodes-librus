<img src="nodes/Librus/librus.png" alt="Librus community node: open book and message logo" width="112" height="112">

# n8n-nodes-librus

An open-source, unofficial n8n community node for reading Librus Synergia inbox messages. MIT licensed. Experimental: the implementation is based on inspected community clients and synthetic fixtures; successful login and inbox behaviour on a real account have not yet been verified.

## What works in this first version

**Librus → Message → Get Many** logs in, initializes the messages session and returns one n8n item per message. It supports a bounded limit or paginated retrieval, string message IDs, sender information, subject, original date strings, read status, attachment presence and tags. Message content from the listing can optionally be decoded from base64 into UTF-8; HTML is preserved. Its completeness needs live verification.

There are no send, delete, attachment-download or mark-as-read operations. Whether listing messages itself affects their unread state still needs a live check. A fresh cookie session is used for each input item; no refresh-token endpoint or persistent session cache is assumed. One reauthentication is allowed after a recognized session-expiry response during scanning. Incorrect credentials, access denial, rate limiting and service errors do not cause login loops.

## Develop

Use Node.js 24 LTS (tested with 24.20.0) and npm:

```sh
npm ci
npm run check
npm run dev -- --custom-user-folder "$PWD/.n8n-dev"
```

The official `@n8n/node-cli` builds and lints the package. Development mode starts an isolated n8n profile; use `N8N_LISTEN_ADDRESS=127.0.0.1 N8N_PORT=5689` if the default port is occupied. Never commit the development profile or account data.

The test suite uses synthetic HTTP fixtures and no real account or network. See [architecture](docs/architecture.md), [live verification](docs/live-verification.md), and [security](SECURITY.md).

## Install on self-hosted n8n

This package has not been published to npm. Build a local tarball:

```sh
npm ci
npm run check
npm pack
```

Install that tarball into the community nodes directory of your **test** n8n installation and restart n8n. For the standard profile, the directory is `~/.n8n/nodes`; container deployments must copy the tarball into the container and preserve the n8n user volume. Follow [n8n's manual installation instructions](https://docs.n8n.io/integrations/community-nodes/installation/manual-install/). Do not use `npm install n8n-nodes-librus` until a release has actually been published.

This is an **unverified, self-hosted community node**. It uses `tough-cookie` for browser-compatible cookie scoping and is not eligible for n8n Cloud verification under the current no-runtime-dependencies rule. `n8n.strict` is deliberately false. The peer dependency remains `n8n-workflow: "*"` per packaging convention; that is not a compatibility guarantee. Development types are pinned to 2.38.1.

## Configure

Create **Librus Session API** credentials using the login and password accepted by the Synergia login form. This may differ from your LIBRUS account email. n8n encrypts credentials using its instance encryption key. The credential test performs a real login and reads one inbox listing entry; it does not return that entry.

Start with **Limit: 10**, **Include Content: off**. Maximum Pages defaults to 20 and is capped at 50. A page contains at most 50 entries. A scan that reaches its page, request or time bound fails without returning partial scan results. Dates remain unchanged because timezone semantics have not been verified.

With **Include Content** enabled, message text enters normal n8n execution data and follows the instance's execution-retention settings. Treat returned HTML as untrusted if rendering it downstream.

## Notifications: next milestone

After live verification, build a workflow around this action:

`Schedule Trigger → Librus → persistent message-ID deduplication → notification delivery`

Scope deduplication to the account and stable string `messageId`. Establish an initial baseline to avoid notifying for the entire existing inbox. Record delivery state after success and use an outbox/idempotency mechanism if duplicate delivery matters. Do not use unread count as a new-message cursor. A forwarded Librus email can trigger an extra scan, but its generic unread notification cannot be relied on as the only signal for every new message.

The package does not yet include an automatic polling trigger or deploy an active workflow. Session reuse, polling intervals, multi-account behaviour, message-body completeness and unread-state preservation require the live checks before unattended use.

## Contribute

Run `npm run check` and `npm pack --dry-run` before submitting changes. Use synthetic fixtures only. Report reproducible schema changes with personal details removed. Update `CHANGELOG.md` for releases. There is no automatic publishing workflow.

Not affiliated with or endorsed by LIBRUS. See [NOTICE.md](NOTICE.md) for protocol research sources.
