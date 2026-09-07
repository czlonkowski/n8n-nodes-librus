# Architecture and evidence

## Execution contract

A programmatic node is necessary because login, redirects, cookie handling and paginated message retrieval are dependent requests. `Librus.node.ts` owns n8n parameters, credentials, item pairing and conversion of safe errors. `LibrusClient.ts` owns the session and response validation. `transport.ts` adapts n8n's modern execution helper and legacy-only credential-test helper.

No process-global cache, workflow static data, environment secret or file stores authentication state. Each client owns a `tough-cookie` jar. The node never outputs cookies, passwords, raw HTTP errors or login response bodies. Node errors are reconstructed from fixed messages. Downstream output deliberately includes message metadata, and optionally the listing's content.

## Observed community protocol

1. GET `https://synergia.librus.pl/loguj/portalRodzina` and follow the browser authorization redirects.
2. POST form fields `action=login`, `login`, and `pass` to the resulting validated HTTPS `api.librus.pl/OAuth/Authorization` route.
3. Follow the returned `goTo` authorization continuation. A terminal verification page stops with `ACTION_REQUIRED`.
4. Request `/gateway/api/2.0/Auth/TokenInfo/` on Synergia.
5. Initialize messages through `https://synergia.librus.pl/wiadomosci3`.
6. GET `https://wiadomosci.librus.pl/api/inbox/messages?page=1&limit=50` and paginate its `data` array.

These are unofficial website routes, not a contracted public API. No verified refresh-token operation is implemented. TokenInfo success is not sufficient proof of inbox access; the credential test also validates a listing response.

## Boundaries

HTTPS and four exact Librus hostnames are allowlisted. Every redirect is checked before a request is issued. URL credentials and non-default ports are rejected. Password-bearing POSTs are restricted to the authorization route and never automatically redirected or replayed. Cookies are obtained from the jar separately for each URL.

Requests time out after at most 15 seconds. An operation is bounded to 120 seconds and 100 requests, including a possible second login. Redirect chains stop after 10 redirects. A recognized session expiry during a scan allows one fresh login and restarts the scan, discarding partial results. Generic HTML, malformed JSON and schema mismatches fail rather than returning an empty inbox. A short page is treated as end-of-list; this assumption must be verified live. Pagination is not a transactional snapshot when messages arrive mid-scan.

No scheduling or cross-execution deduplication lives in the action node. Notification workflows will own account-scoped durable cursors and delivery state. Reading listing entries does not explicitly call a mark-read endpoint; side effects still need live measurement.

## Source references

- [FlakM/librus-rs authentication](https://github.com/FlakM/librus-rs/blob/224bd49c613a2f416f757aab6ad44c40ac2b4d9b/src/lib.rs) and [message schema](https://github.com/FlakM/librus-rs/blob/224bd49c613a2f416f757aab6ad44c40ac2b4d9b/src/structs/messages.rs): browser OAuth and new inbox route.
- [Mati365/librus-api](https://github.com/Mati365/librus-api/blob/9b47c3c460728fa674e6e6aba530558dbd0b486f/lib/api.js): authorization URL validation and current login sequence. Its legacy inbox is not used here.
- [n8n community-node development](https://docs.n8n.io/integrations/creating-nodes/overview/): package and node conventions.

Implementation was written independently from these protocol observations. Source inspection and offline fixture success are not live integration evidence.
