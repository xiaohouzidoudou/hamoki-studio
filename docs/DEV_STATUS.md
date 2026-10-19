# Hamoki Studio / Cowart — development handoff snapshot

**Snapshot date:** 2026-10-19 (UTC). This is a historical record; always verify live GitHub refs and deployment before claiming current state.

## Canonical pointers
- Integration PR: #22 (`feature/cowart-web-canvas-20261016` -> `main`, Draft).
- Last examined application change: `3d2107f` (fullscreen image closes on outside click).
- Last independently verified QA serving application code: `285e88f` (double-click preview / Space-pan improvements); **later image-modal fix was not yet confirmed deployed when this snapshot was written**.
- Existing branch CI: `.github/workflows/cowart-build.yml`; refer to actual GitHub Actions for latest SHA/test status.

## Verified functionality
- Isolated QA Docker deployment, HTTPS, authentication guard, and healthz checks have previously passed.
- Studio image generation produced a persisted completed image task, but that does **not** prove Cowart's complete edit-and-canvas workflow.
- Double-click/Space-pan focused tests passed, CI succeeded, and QA was rebuilt for `285e88f`.
- Outside-preview-click handler was committed as `3d2107f` and CI succeeded; deploy still required at snapshot time.

## Open blockers
1. Confirm latest QA deployment SHA and visually validate outside-click close and keyboard behavior.
2. Real provider E2E: create an image, select/edit twice, place results, refresh/reload and verify job recovery; obtain user authorization for paid calls.
3. Confirm appropriate tldraw licensing before production.
4. Test ambiguous billing outcomes, timeout, refresh and duplicate-submit handling.
5. Only after user acceptance: stage production promotion with verified data backup and rollback.

## Next handoff fields (fill with evidence, not guesses)
- Responsible agent / linked Issue or PR:
- Source SHA / branch:
- CI workflow run and conclusion:
- Actually deployed environment and SHA:
- Browser / endpoint checks and result:
- Remaining problem / next action:

See `docs/AI_COLLABORATION.md` for conflict-free working rules. Production remains separate.
