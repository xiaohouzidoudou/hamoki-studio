# Hamoki Studio V1.1 · Secure Accounts

This release adds the isolated backend-v2 account gateway while preserving the frozen V1 canvas interface and original V1 Git tag.

- Admin username is reserved as `hamoki`. On a fresh deployment, an unpredictable one-time activation code is printed to the server operator console. Only the owner can activate the administrator and choose a password.
- Registration uses username/password without invitation code; each account gets its own worker, canvas, project history, provider secrets and private 1 GiB media storage.
- Account management includes role-restricted user disabling and password resets (one-time temporary password, admin password re-verification, password change required).
- Sub2 credential/token and API key are encrypted; Sub2 login and balance/model synchronization endpoints are included. No real paid generation test is performed during release.
- Legacy `POST /api/jobs` accepts jobs quickly and the existing queue polls completion. Upstream 429 may retry with a limit; 504/524 uncertain-charge results do not automatically resubmit.
- Dedicated Sub2 async task ledger keeps one persisted request ID per user. Upstream async support and actual accounting must still be validated with the intended Sub2 model before paid production use.
- Account API and session responses use `Cache-Control: private, no-store`; configure your CDN not to cache `/api/*`.

For Docker, see `Dockerfile.v2` and `compose.v2.yaml`. The gateway and private workers listen on loopback only; HTTPS belongs on a separate reverse proxy. Deploy V2 with a **new named data volume**; do not attach or delete the old V1 data volume. Keep the SQLite WAL files and master.key together for recovery.

The V1 workspaces are NOT automatically migrated into any V2 account. Any future migration should be explicit, verified, and reversible.

