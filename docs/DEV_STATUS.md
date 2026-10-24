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


## ChatGPT 联合集成审查（2026-10-24）

- 关联 #23 / PR #33；隔离审查分支组合顺序 #26 → #32 → #27 → #28 → #29 → #30 → #31。七项最新 head 分别为 5e56c14 / 93f7c31 / 3ed8b69 / bcd81e0 / 5194328 / 5cd812e / 30575ea，均有对应成功 CI。未发现文本冲突；共享存储、版本确认、任务恢复/终态确认及 CI 用例入口均保留。此顺序为已实测组合，其他顺序未作保证。
- 联合代码树 6da220681fdbe57888afad3fe080c8cc69af465e，本机 Node 24 全量 178/178、前端构建、交接与 diff 检查通过。测试本机回环服务需 NODE_USE_ENV_PROXY=0；首次环境代理导致的 503 不归为产品失败。
- 增强回归提交 e4a1e0a / 7a8fa9f：大图异步上传成功后的旧保存响应不能清除同时发生的新编辑；清空本地恢复记录后，排队/运行取消仍恢复原 ID，必须确认终态才可开启下一轮，迟到结果不回填。
- 精确 7a8fa9f 在独立临时 Node 22 + 系统 Chromium 环境通过全部三套浏览器脚本：大图失败/重试与并发编辑、键鼠/预览/保存刷新、模拟生图及两轮编辑/断线恢复、Holder/比例/逐图角色、持久取消/确认。截图已查看。额外临时 Node 22 后端全量 173/178：五项失败均因缺少 Pillow；以本机完整依赖与完整 GitHub CI 为全量结论依据，不隐去该环境缺口。
- e4a1e0a 完整 CI success：Actions 40078079417。最终提交仍须匹配完整成功 CI；PR #33 保持 Draft 直至该门槛通过。
- 审查时隔离 QA 已部署的仍是 0559e06，源码与运行后端哈希一致，health 200 / 匿名画布 401；本节不是新组合已部署的声明。实际后续集成/部署 SHA、浏览器验收以 #23 最新记录为准。
- 未修改正式网站/用户数据，未调用付费模型；#22 保持 Draft，不合 main。真实上游效果、停止/计费语义、跨设备真实模型、许可及故障回滚演练仍是独立未完成门槛。


## Independent Hamoki Canvas (2026-10-24)

- Linked #23; task branch `chatgpt/23-independent-canvas`, based on e7e2655.
- Independent project-owned document/geometry/history engine and SVG/Canvas renderer replace the editor SDK; no tldraw runtime/build dependency or license-key injection remains. React and fractional-indexing remain normal dependencies.
- Existing authenticated upload/snapshot/job/recovery/cancellation endpoints are reused. Native schema adds hamokiCanvas=1 while keeping old IDs/metadata/opaque records; invalid/newer snapshots fail closed.
- Full local 186/186 tests, build and isolated system-Chromium all four scripts passed. Actual new tool UI, mouse operations, file import and ZIP are covered, alongside existing result/save/asset/cancel regressions.
- See `docs/hamoki-native-canvas-acceptance.md` for supported behavior and explicit legacy visual limitations. Exact CI and actually deployed QA SHA/browser status remain in Issue #23. This entry does not claim a deployment.
- No paid model calls, no main/production update or existing user data migration. Native snapshots preserve the old envelope so a previous renderer still has the original raw records; retain pre-deploy backup and old image before QA promotion.

## Independent canvas full feature parity — in development (2026-10-24)

- User clarified that the original Cowart's complete visible canvas behavior is required. #34 and its deployed integration `394bf04` are a core milestone only. #22 remains Draft; main/production are unchanged.
- Owner ChatGPT; branch `chatgpt/23-canvas-feature-parity`, based on `394bf0450e0613bead23f874f33d8f622aa0a7c3`. Inventory and acceptance requirements: `docs/hamoki-canvas-feature-parity.md`.
- Expanded implementation includes sixteen geometry variants, draw/highlight/eraser/laser, independent legacy point decoding, arrows with live bindings, rich text, crop/flip, affine group transformations, arrange/styles, clipboard/pages, SVG/PNG/JSON, and view/input controls. Implementation and verification are ongoing; this is not a full parity or QA promotion claim.
- Earlier checkpoint: full local 197 tests and build passed. Expanded real-Chromium regression exposed menu overlap, stale resize handles intercepting new tools, and an undefined property differing after JSON round-trip; fixes are being reverified with the complete suite. Exact final CI/SHA/QA evidence must be recorded in #23 before merge/deploy.
- Expanded native schema is version 2: old native/legacy documents can be read; old version 1 rejects version 2 documents. QA rollback must pair the old image with the pre-upgrade backup. No paid provider calls or production data migration.

### Expanded tool milestone follow-up

- Full local suite now 201/201, frontend build and handoff/diff checks pass. Remote system-Chromium ran all four scripts successfully at the preceding checkpoint, including imported-source edits and the original five Holder/reference submissions; the latest text/history/binding additions receive another final native run and exact-head CI.
- Initial PR35 head 9d23275 CI run 40100426107 failed because the old marquee fixture began on the added menu. It is changed to start on actual blank canvas and still enclose the same image. The subsequent combined browser run additionally exposed `padding: "auto"` compatibility in reference export; the exporter now handles it while retaining the exact submission-count checks.
- Rich text now saves while editing and groups its creation/typing into one undo. Successful remote asset URL commits are carried through matching undo/redo snapshots while previously captured save snapshots stay immutable. Frame creation adopts contained annotations so a populated AI holder cannot be misclassified as empty.
- This remains an expanded milestone, with full-parity gaps documented explicitly in the matrix (media formats, portable asset backups, embed adapters, object snap and remaining legacy/device acceptance). No new QA promotion or overall completion is claimed by this entry.


### Portable archive increment (2026-10-24)

- Expanded tool PR #35 is merged at integration `983c54287da22da04e73d71bdb5b470424d88207`. Exact push CI 40104063507 succeeded (201 tests and four browser scripts); isolated QA was verified at the same source/deployed SHA with healthy image and matching frontend/backend hashes. Actual HTTPS tools and original save/upload/recovery/cancel combinations passed, with no paid provider attempts. Issue #23 has the evidence and limitations.
- Owner ChatGPT; next branch `chatgpt/23-canvas-portable-backup` adds actual image bytes to complete ZIP export and restores into additional pages. Existing emergency structure JSON is retained. Asset format/size and account quota limits continue to apply; no jobs are enqueued by archive operations.
- New code validates archive paths, checksums, hierarchy and schema before upload, preserves original media, remaps all imported IDs/known annotation references, and separates old history provenance from active source IDs. Streaming saves avoid unbounded archive buffers; cancellation and download failure are explicit.
- Dedicated Node/API/browser regressions are added; exact final CI, integration SHA and deployed QA status must be recorded in #23 before claiming this increment accepted. The source document contains specific limits and remaining full-parity gaps: `docs/hamoki-canvas-feature-parity.md`.
- #22 stays Draft. No main merge, production changes, existing user data migration, or paid-model calls.
