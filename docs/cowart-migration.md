# Cowart migration (experimental)

Upstream: https://github.com/runc/Cowart and https://github.com/zhongerxin/Cowart. Cowart source has an MIT LICENSE, copied to cowart/LICENSE.cowart; tldraw has a separate licensing policy. Confirm tldraw authorization before production use: https://tldraw.dev/community/license.

This branch vendors the React/Vite Cowart browser canvas into cowart/, preserving the existing Studio production implementation and data. The Vite base path is /cowart/.

To build locally: cd cowart && npm ci && npm run build.

NOT YET INTEGRATED: server-side account and project synchronization; encrypted existing Studio providers; job queues and idempotent retries; Style DNA, Creative Workflow, image derivation, editing/cutting; deployment and regression testing. Cowart browser BYOK keys must NOT be used for production. Do not deploy to the public Studio or replace the old UI until the account-gated adapter and project migration have been implemented and tested.
