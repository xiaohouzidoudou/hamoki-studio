# Cowart → Hamoki Studio migration tracker

Upstream: [Cowart original](https://github.com/zhongerxin/Cowart) and [Cowart Web](https://github.com/runc/Cowart).

## Implemented in feature/cowart-web-canvas-20261016

- Copied Cowart Web React/Vite/tldraw canvas into `cowart/`, retaining upstream MIT attribution at `cowart/LICENSE.cowart`. The tldraw dependency has its **own** license.
- `COWART_PREVIEW=1` opt-in preview at `/cowart/`, behind Studio's existing HTTP-only login cookie. Default is OFF; no changes to the legacy UI.
- Docker multi-stage Vite build, bundled frontend assets, strict same-origin asset CSP, and server-side authenticated preview.
- Per-account and per-existing-project canvas snapshots at `GET/PUT /api/cowart/snapshot?projectId=<uuid>`. Writes use optimistic revision checks (409 on stale writes), account ownership checks, 12 MB request cap and existing 1 GiB / 5 GiB limits. The UI visibly alerts on failed saves and offers a JSON backup.
- Server-backed model/provider selection through existing Studio `/api/providers`. **No browser-side API keys.** Added Cowart panel that submits image jobs through Studio `POST /api/jobs` with idempotency keys, polls job status, renders queued/running/done/failure, and inserts completed same-origin media images into the Cowart canvas.
- One-way **explicit** import from a Studio project's original nodes to Cowart (image, reference, note). Deduplicates using original node metadata; never edits or deletes the old project. Batch limit 250 elements per click. Generated images use existing authenticated server media URLs.
- Project picker and per-project browser camera state; image assets and Cowart source canvas persisted server-side per account.
- Added Actions CI to build Cowart and run the entire Studio test suite (including dedicated multi-account preview/snapshot/conflict/restart tests).
- Added `/api/cowart/plan`: uses the chosen server-side **text** model with current selected shapes, nearby annotation notes, project Style DNA and scoped conversation; model output can only request discussion, a single generation, or an edit. The frontend never gives the model account credentials, image bytes, direct SSH, or arbitrary tool permissions.
- Smart execution is opt-in per send and submits at most one paid image job. Direct generation remains a manual fallback. `GET /api/cowart/messages` persists a project-scoped text planning conversation without leaking to other users.
- Pending job IDs and anchors survive refresh in sessionStorage; uncertain billing outcomes block silent resubmission and offer an explicit check-original-job button.
- CI now runs a real headless Chromium smoke test including authenticated entry, drawing a shape, server save and reloading it. Screenshot artifacts are retained.
- Bundles tldraw fonts/icons/translations in the Vite output to avoid CDN requests under strict CSP; allows local `data:` translation fetches only.

## Developer build

```sh
cd cowart
npm ci
npm run build
```

For Docker preview, set a legitimately issued tldraw license through build argument `VITE_TLDRAW_LICENSE_KEY` and set `COWART_PREVIEW=1` in runtime environment. `APP_BASE_PATH` must be empty for this first preview. The preview uses Studio's existing account sessions, NOT a second login.

- **Visual inspection added:** when an actual image is selected, the operator may opt into a second, independent Studio **vision** provider/model. Existing generated-image IDs are resolved to media owned by the current project; external selected images are rasterized in the browser with a strict 8 MB server bound. The upstream vision model produces a text observation which precedes Style DNA in the text-planner prompt. Only the observation (not raw image bytes or API keys) reaches the text planner. The preview informs users that this consumes vision-model usage.
- Vision and text model calls are mock-tested end to end, including source ownership validation, malformed/foreign visual payload rejection, no automatic image job creation, and ensuring original image bytes are not forwarded to the text model. Separate Chromium browser smoke checks the vision on/off control.

## Hard blockers before production cutover

1. Perform a real browser E2E test under two separate users: login, first launch, save, refresh, reopen on another machine, annotation export, reference-image edit and image insertion.
2. Run a paid upstream test **with user permission**, verify submitted ID, billing-safe uncertain-failure behavior, and history image retrieval. CI uses no paid keys.
3. Verify tldraw production license and confirm no more restrictive terms were imported from third-party forks.
4. Finish **multi-step/visual agent tool orchestration**: selection and image pixels now reach a constrained vision+text planner, but Cowart's full generalized tool-calling cycle, multi-image semantic blending, automated image reviews and direct in-canvas component extraction still need integration and live provider tests.
5. Integrate Studio's Style DNA, existing Creative Workflow, image derivation and component slicing as context-dependent actions (server data is retained and generation already reuses project context, but the full UI controls have not moved).
6. Improve snapshot/media handling for larger canvases: currently a canvas containing many imported inline base64 images can exceed the 12 MB snapshot request cap; Studio-generated images use server URLs.
7. Finish project migration/export/rollback and identify orphaned media/deleted historical images.
8. After backup of production data volumes and license review, perform a gated staging deployment and visual UX verification before touching production.

## Important behaviors and safeguards

- Existing production `main` code, invitation accounts, encrypted provider credentials, queued jobs, images, projects and creative workflow data are unchanged by this PR.
- The preview is disabled by default and does not expose provider secrets to frontend JavaScript.
- Cowart-generated images are immediately placed on the selected canvas or next to the selected original; the source original remains intact.
- A network timeout during a paid job is **uncertain**, not an automatic free retry. The UI asks the user to inspect the existing Studio task queue before re-submitting.
- Saving a stale canvas returns 409; the editor does not silently overwrite the other editor's work, and its user can download a JSON backup.
- The old Studio canvas remains accessible for comparison and export; no automatic destructive migration or silent cutover.
