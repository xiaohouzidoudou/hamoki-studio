# Hamoki Studio — shared development rules for Codex and ChatGPT

Scope: this **public product repository only**. Never copy personal/global AgentDock instructions into this repository.

## Start every task
1. Read `docs/AI_COLLABORATION.md`, `docs/DEV_STATUS.md` and the active GitHub Issues/PRs.
2. Fetch the latest remote refs. Confirm which branch you are on and whether the working tree is clean.
3. Create or claim a focused Issue and work on an **agent-specific task branch**, for example `codex/issue-123-fix` or `chatgpt/issue-123-fix`. Base it on the current integration branch, not a stale local copy.
4. Open a PR targeting `feature/cowart-web-canvas-20261016`. Do not edit the same file from two branches without checking the other agent's changes. The integration branch is for reviewed PR merges, not concurrent direct edits.
5. Do not merge the Cowart integration branch into `main` before actual paid-model E2E verification and license review.

## Work and verification
- Reuse existing code and tests. Fix the specific issue before adding unrelated features.
- Validate the changed behavior locally; run `npm test` and `cd cowart && npm run build` when applicable. Trust CI only when it matches the exact proposed commit.
- Before PR merge, record tested commit SHA, passing/failing checks, known risks, and rollback/QA impact.
- Changes affecting images, jobs, timeout handling, or billing must avoid automatic paid retries; preserve task identity.
- Use existing dark, green-accented, desktop-oriented UI; single-click selects, double-click opens image, Space-drag pans, middle mouse pans.
- Every significant result goes into the Issue/PR; do not assume ChatGPT and Codex can read each other's chat history.

## Security and deployments
- Never commit production or QA credentials, server topology, private endpoints, personal recovery documents, machine addresses, tokens, or access paths. The public repo gets product code and generic deployment instructions only.
- Production is **not** updated by integration branch changes. QA has separate credentials, data and Docker deployment.
- CI passing does not prove real provider end-to-end behavior. Only claim successful real image generation/editing after verifying it and documenting the evidence.
- The automated QA process, where installed, may deploy **only** the pinned integration branch after a matching successful push CI run; inspect its isolated health and preserve rollback.
- If an authorization check or management safety control blocks a step, do not bypass it or claim deployment succeeded.

## Handoff
At each task boundary, update the PR/Issue, then revise `docs/DEV_STATUS.md` or `docs/DEV_TASKS.md` when a milestone genuinely changed.
Include: commit, test evidence, what is deployed vs only committed, blocked work, next concrete action, and the owner. Documentation snapshots can become stale; prefer current GitHub run and actual server health.
