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

## Codex P0 已保存画布媒体保护（2026-10-19）

- Issue #24，分支 `codex/24-canvas-media-protection`，基于 `0559e06`。媒体拆分上传仍待处理；本项不扩大快照上限。
- 已复现容量回收删除已保存画布原图；现在读取当前账号所有落盘画布的媒体引用并保护，引用不可确认则在清理前返回 503。确无容量返回 413，成功保存移除引用后恢复普通回收。
- 真实临时网关回归先红后绿：已保存引用保留、超额上传拒绝、解除引用后正常回收、跨账号读图拒绝。多快照与损坏数据等回归及全量 163 项测试、构建通过；详情见 `docs/cowart-media-acceptance.md`，具体提交及 CI 以 PR/Issue 为准。
- 补充真实网关损坏快照与容量压力回归：先复现 503 被转换为 400，现保留 503 且原图不删除；完整测试和精确 CI 以 PR #30 最新记录为准。
- 未部署、未调用付费模型。待审 PR 需审查、合入集成后运行组合 CI 和隔离 QA，整体 P0 尚未完成。

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
