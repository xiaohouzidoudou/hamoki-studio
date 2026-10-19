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

## Codex P0 修复：图片回填与刷新恢复（2026-10-19）

- 关联 Issue #24；任务分支 `codex/24-result-save-recovery`，基于 `002126e`。精确提交及 CI 以任务 PR/Issue 交接记录为准。
- 已定位并修复：远程图片错误写入 `fileSize: 0` 导致 tldraw 拒绝回填/导入；URL 前缀加页面计数器在刷新后撞 ID 并覆盖旧图；图片尚未保存时过早清除原任务恢复编号。
- 当前逻辑：图片资产与形状使用随机 UUID；未知文件大小不填；服务器快照确实包含对应项目和结果图片后才清除恢复编号。未保存时阻止新任务覆盖恢复状态。
- 本机全量 161 项测试、Cowart 构建通过。真实 Chromium 使用模拟图片接口，覆盖一张新图、连续两轮编辑、原图保留与从左到右排列、保存失败后刷新恢复、恰好三次提交、旧素材导入及去重。
- 模拟接口不代表真实模型编辑质量或计费验收。本轮未部署 QA、未改生产、未调用付费模型；待任务 PR 审查和精确提交 CI 通过后再进入隔离 QA。
- 后续：真实模型兼容性与连续编辑验收、跨账号/设备恢复、键鼠交互验收、回滚演练及许可审查仍按 #23/#24 推进。

## Codex P0：关页与跨会话任务恢复（2026-10-19）

- 分支 `codex/24-durable-job-recovery`，基于网页端已合并 #25 的集成提交 `0559e06`；提交与 CI 证据在关联任务 PR 和 Issue #24。
- 复用既有 `jobs.json`，保存有界的 Cowart 请求编号、原页面及图片锚点。新会话先查询服务器原任务；恢复只读取原任务，不新建生图。任务结果回到提交页面，避免切页后放错位置。
- 同账号同项目仅允许一个未处理 Cowart 任务；相同幂等键仍返回原任务，两个窗口并发和旧任务重试均不能绕过限制。失败/取消/中断需要用户明确确认；完成图片需服务器快照成功保存后才解除占用。手动重试将恢复身份转交给新任务。
- 后端回归覆盖独立登录、服务重启、双账号隔离、并发提交、幂等、取消确认、保存冲突、完成确认和重试转交；Chromium 回归丢弃已接受任务的 POST 响应，切换页面后找回原任务，再关闭原标签页从空 sessionStorage 的新标签页恢复，并模拟恢复查询断线，验证总共只有三次图片提交。
- 本机全量 162 项测试与 Cowart 构建通过；浏览器图片 API 使用模拟接口，账号/项目/快照走真实 gateway。尚未部署本任务，真实付费模型与跨设备真实浏览器 E2E 仍需验收。
