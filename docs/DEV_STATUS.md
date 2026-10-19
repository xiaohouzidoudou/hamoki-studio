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

## Codex P0 图片拆分上传（2026-10-19）

- Issue #24，分支 `codex/24-canvas-asset-upload`，基于当前集成 `0559e06`。精确提交及 CI 以任务 PR/Issue 为准。
- 二进制图片独立落盘，快照只存账号媒体 URL；旧内嵌图在下一次保存迁移。账号内内容去重与重启复用，单图 12MB、账号/全局容量和 4096 索引项有界；不足直接拒绝，不删已有作品。
- 本机 166 项测试、构建通过。Chromium 验证两张各 5MB 内嵌图片使原快照超过 12MB，失败上传保留原图，重试后快照小于 100KB，移动/刷新无重新上传；权限、配额、索引失败/重启及并发替换测试通过。详情 `docs/cowart-asset-upload-acceptance.md`。
- 未合并/部署、未调用付费模型。需与 #29 保存版本及 #30 原图保护等待审 PR 组合回归后进入隔离 QA。上传但未入快照的媒体保守保留，后续仍需统一素材生命周期；真实模型请求体和真实 E2E 不由本项证明通过。

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
