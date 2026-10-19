# Codex Desktop × ChatGPT collaboration

## Shared source of truth
- Repository: `xiaohouzidoudou/hamoki-studio`.
- Cowart integration branch: `feature/cowart-web-canvas-20261016`.
- Cowart integration PR: #22, targeting `main`; **Draft until production acceptance**.
- GitHub Issues: task claims and acceptance criteria.
- Separate task branches + PRs: actual code changes.
- GitHub Actions: validates exact commits. Passing checks are not a substitute for E2E paid-model verification.
- `docs/DEV_STATUS.md`: last verified snapshot; `docs/DEV_TASKS.md`: shortlist and definitions of done.

## Ownership and collision avoidance
- **Codex Desktop:** local feature implementation, unit/integration/UI tests, PRs from `codex/*`.
- **ChatGPT:** code review, targeted fixes from `chatgpt/*`, safe QA staging, real environment checks, regression triage.
- Whoever starts a task claims its Issue with a comment: `Owner: Codex` or `Owner: ChatGPT`, and links the working branch/PR.
- Agents don't share live conversation memory. They communicate by GitHub Issue and PR description, comments, commits and CI evidence.
- Before editing, fetch and compare current refs. If a PR touches files claimed by the other agent, review and coordinate **before** modifying.
- The integration branch receives passing, reviewed PRs. Never force push. Never use it as a simultaneous scratch branch.

## Recommended workflow
1. Create/find an Issue with steps to reproduce, user-visible expected behavior, and acceptance criteria.
2. Claim ownership, make a branch from latest integration SHA.
3. Make focused changes and self-test; update or add regression tests.
4. Push branch and open PR targeting the integration branch. Fill the PR template and link the Issue.
5. After CI success, verify exact SHA and merge the reviewed PR. If CI fails, fix on task branch.
6. Isolated QA staging may auto-deploy the integration branch **only after a successful matching push CI**. Check what SHA actually reached QA.
7. After smoke testing, comment on the Issue and update the development snapshot as needed.
8. Production promotion remains separate and manual, requiring user acceptance, tldraw licensing, backups, upstream E2E and rollback evidence.

## Deployment distinction
- "Committed" = GitHub repository contains code.
- "CI passed" = automated tests passed for a particular SHA.
- "QA deployed" = isolated running container serves that SHA with HTTPS verified.
- "E2E passed" = authorized real provider task, image insertion, refresh recovery and error/retry behavior verified.
- "Production ready" requires all required gates; never infer this from other statuses.

Only an already-approved private server control plane may perform QA deployment. The public repository MUST NOT carry private SSH credentials, tokens, private server paths, account configuration or internal infrastructure notes.

## Onboarding a new agent session
Read `AGENTS.md`, this guide, current Issue/PR, and live CI status; get integration SHA and deployed QA SHA separately. Continue from current code rather than repeating already completed work. Record any blocked operation accurately without asking the user to repeatedly transfer status.
