# Architecture and evidence

## Execution contract

A programmatic node is necessary because login, redirects, cookie handling and paginated message retrieval are dependent requests. `Librus.node.ts` owns n8n parameters, credentials, item pairing and conversion of safe errors. `LibrusClient.ts` owns the session and response validation. `transport.ts` adapts n8n's modern execution helper and legacy-only credential-test helper.

No process-global cache, workflow static data, environment secret or file stores authentication state. Each client owns a `tough-cookie` jar. The node never outputs cookies, passwords, raw HTTP errors or login response bodies. Node errors are reconstructed from fixed messages. Downstream output deliberately includes message metadata and optional preview or full content, identified by `contentSource`. Preview remains the default for existing workflows.

## Observed community protocol

1. GET `https://synergia.librus.pl/loguj/portalRodzina` and follow the browser authorization redirects.
2. POST form fields `action=login`, `login`, and `pass` to the resulting validated HTTPS `api.librus.pl/OAuth/Authorization` route.
3. Follow the returned `goTo` authorization continuation. A successful flow may terminate at Synergia `/loguj/portalRodzina`; this callback is allowed, with TokenInfo and inbox access still checked afterward. A terminal verification page stops with `ACTION_REQUIRED`.
4. Request `/gateway/api/2.0/Auth/TokenInfo/` on Synergia.
5. Initialize messages through `https://synergia.librus.pl/wiadomosci3`.
6. GET `https://wiadomosci.librus.pl/api/inbox/messages?page=1&limit=50` and paginate its `data` array. Its `content` field is a truncated preview.
7. Only when Include Content is enabled and Content Source is Full Message, fetch `/api/inbox/messages/{messageId}` for each selected message in the same session. Validate the returned ID and decode the case-sensitive `data.Message` field as the full body.

These are unofficial website routes, not a contracted public API. No verified refresh-token operation is implemented. TokenInfo success is not sufficient proof of inbox access; the credential test also validates a listing response.

## Boundaries

HTTPS and four exact Librus hostnames are allowlisted. Every redirect is checked before a request is issued. Legacy HTTP Location headers targeting exact allowlisted hosts are upgraded to HTTPS before sending; no request is made over HTTP. URL credentials and non-default ports are rejected. Password-bearing POSTs are restricted to the authorization route and never automatically redirected or replayed. Cookies are obtained from the jar separately for each URL.

Requests time out after at most 15 seconds. An operation is bounded to 120 seconds and 100 requests, including a possible second login. Redirect chains stop after 10 redirects. A recognized session expiry during a scan allows one fresh login and restarts the scan, discarding partial results. Generic HTML, malformed JSON and schema mismatches fail rather than returning an empty inbox. A short page is treated as end-of-list; this assumption must be verified live. Pagination is not a transactional snapshot when messages arrive mid-scan.

No scheduling or cross-execution deduplication lives in the action node. The separate Librus Trigger owns account-scoped discovery history; downstream workflows own delivery state. Reading listing entries does not explicitly call a mark-read endpoint; side effects still need live measurement.

## Source references

- [FlakM/librus-rs authentication](https://github.com/FlakM/librus-rs/blob/224bd49c613a2f416f757aab6ad44c40ac2b4d9b/src/lib.rs) and [message schema](https://github.com/FlakM/librus-rs/blob/224bd49c613a2f416f757aab6ad44c40ac2b4d9b/src/structs/messages.rs): browser OAuth and new inbox route.
- [Mati365/librus-api](https://github.com/Mati365/librus-api/blob/9b47c3c460728fa674e6e6aba530558dbd0b486f/lib/api.js): authorization URL validation and current login sequence. Its legacy inbox is not used here.
- [n8n community-node development](https://docs.n8n.io/integrations/creating-nodes/overview/): package and node conventions.

Implementation was written independently from these protocol observations. Source inspection and offline fixture success are not live integration evidence.

## Full message retrieval

Complete pagination and deduplication before issuing detail requests. Reject more than 50 selected messages before any detail request. Fetch sequentially within the existing 100-request/120-second operation budget, with one recognized session-expiry recovery for the whole operation. Fail on missing/mismatched details or invalid base64; never silently fall back to preview. No partial output is emitted. Detail requests may affect unread state; previous reads cannot be rolled back on a later failure. The returned readDate remains the pre-detail listing snapshot. Message IDs are restricted to safe alphanumeric, underscore and hyphen path segments before detail retrieval.

## Read filters and single-message content

Get Many filters listing metadata locally using readDate (null/absent/empty means unread) before applying the requested result limit. Pagination progress is tracked separately from matching results, so a full page of read messages does not prematurely terminate an unread scan. Full bodies are requested only after selection. During session recovery after unread/full selection, retain the selected IDs: re-filtering the inbox could lose messages already marked read by earlier detail requests. Other scan recovery retains the existing restart behaviour. Get Content takes a validated ID and returns only messageId/content/contentSource; it shares the guarded detail route and one-session-recovery limit.

## Polling contract

LibrusTrigger implements IPollFunctions with polling:true; n8n injects Poll Times. Automatic polls scan the whole inbox across all read statuses. The first complete scan records a silent baseline. Subsequent complete scans emit unseen IDs and retain a union of up to 10000 IDs; reaching capacity or encountering invalid state fails without mutating history. A SHA-256 account fingerprint uses credential ID and username, not password, so password rotation does not replay messages. Changing account establishes a new baseline. Manual mode retrieves a single preview sample and never accesses static data.

State comparison and assignment occur after the asynchronous scan, with no await between them. This avoids duplicate emission for overlapping calls sharing the same state object. It does not provide distributed locking for stale copies or multi-instance executions. The cursor advances before downstream delivery; a failed downstream action must be recovered through execution retry, not another poll. IDs of messages moved out of the inbox remain in history. This is discovery deduplication, not a transactional outbox or an exactly-once guarantee.

Verified installed n8n 2.37.10 code: n8n-core/dist/nodes-loader/directory-loader.js injects commonPollingParameters; active-workflow-triggers.js runs an activation poll; n8n/dist/workflows/triggers/workflow-trigger-activator.js saves static data after registration. workflow-execution.service.js and poll-cursor.service.js commit a durable cursor with the execution before downstream processing where durable scheduling is enabled. Legacy and durable behaviour depends on host configuration; no host-internal APIs are imported by this package.

Public Librus frontend research (2026-09-07): https://wiadomosci.librus.pl/nowy/inbox serves App-DRe0BPBk.js under /nowy/assets/. Its UI includes an unreadOnly filter, a GET inbox detail route and unread counts, but the inspected code exposes no mark-unread action. Only protocol observations were used; no frontend implementation was copied. Local filtering uses the listing contract already exercised by the client rather than relying on another unverified server query parameter.
