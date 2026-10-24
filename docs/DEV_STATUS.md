# Hamoki Studio / Cowart — development handoff snapshot

**Snapshot date:** 2026-10-19 (UTC). This is a historical record; always verify live GitHub refs and deployment before claiming current state.

## Codex P0 图片拆分上传（2026-10-19）

- Issue #24，分支 `codex/24-canvas-asset-upload`，基于当前集成 `0559e06`。精确提交及 CI 以任务 PR/Issue 为准。
- 二进制图片独立落盘，快照只存账号媒体 URL；旧内嵌图在下一次保存迁移。账号内内容去重与重启复用，单图 12MB、账号/全局容量和 4096 索引项有界；不足直接拒绝，不删已有作品。
- 本机 166 项测试、构建通过。Chromium 验证两张各 5MB 内嵌图片使原快照超过 12MB，失败上传保留原图，重试后快照小于 100KB，移动/刷新无重新上传；权限、配额、索引失败/重启及并发替换测试通过。详情 `docs/cowart-asset-upload-acceptance.md`。
- 未合并/部署、未调用付费模型。需与 #29 保存版本及 #30 原图保护等待审 PR 组合回归后进入隔离 QA。上传但未入快照的媒体保守保留，后续仍需统一素材生命周期；真实模型请求体和真实 E2E 不由本项证明通过。

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

## Codex P0 任务取消与请求结果（2026-10-19）

- Issue #24，分支 `codex/24-job-cancel-outcome`，基于集成 `0559e06`。具体提交及 CI 以任务 PR/Issue 为准。
- Cowart 复用原任务取消，响应丢失重新查询原 ID；明确区分未调用图片上游、HTTP 拒绝、图片已返回与未知，不能据此承诺退款。证据持久保存，新尝试清空旧证据。
- Cowart 429 不自动重新发起图片生成；失败/取消/中断后需明确开启下一轮，运行取消费用未知时需再次确认。
- 本机全量 165 项测试、构建通过。真实网关+模拟上游覆盖取消/拒绝/断线/本地失败/重启/重试确认；Chromium 恰好两个任务、一次上游调用、两次取消请求，既有模拟生图/两轮编辑恢复回归通过。详情 `docs/cowart-job-cancel-acceptance.md`。
- 未合并/部署、未调用付费模型。需与 #26 服务端任务恢复等候审 PR 组合回归；真实模型、计费和跨设备验收、默认模型兼容、许可及回滚仍未完成。

## Next handoff fields (fill with evidence, not guesses)
- Responsible agent / linked Issue or PR:
- Source SHA / branch:
- CI workflow run and conclusion:
- Actually deployed environment and SHA:
- Browser / endpoint checks and result:
- Remaining problem / next action:

See `docs/AI_COLLABORATION.md` for conflict-free working rules. Production remains separate.

## Codex P0 保存一致性修复（2026-10-19）

- Issue #24，分支 `codex/24-save-consistency`，基于集成 `0559e06`。具体提交和 CI 以 PR/Issue 为准。
- 旧保存响应仅确认所捕获的文档版本；上传期间的新编辑继续保持待保存，后续请求写入最新版本。无效快照不再清除待保存状态。
- blob 图片转 data URL 时复制快照和图片记录，不修改编辑器原记录；无法捕获图片则明确报保存失败，避免把缺失图片的画布当作已保存。
- 本机 163 项测试、Cowart 构建通过。真实 Chromium 延迟一次 PUT 响应，期间移动形状，验证新位置最终写入真实网关并刷新保留；既有模拟生成和两轮编辑、失败保存恢复、恰好三次图片提交通过。截图已检查。
- 尚未部署或调用付费模型；媒体拆分上传与容量、任务取消、模型默认能力、真实模型/跨设备验收仍待继续。待审 #26/#27/#28 仍需审查；本修复不能代替组合后的 CI 和 QA。

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
