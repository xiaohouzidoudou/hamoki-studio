# Cowart task board

**Issues and pull requests are authoritative.** This is a concise milestone snapshot, not an auto-updating live dashboard. Open tasks only when a user-visible acceptance check exists.

| ID | Priority | Owner / state | Acceptance |
| --- | --- | --- | --- |
| COW-QA-01 | P0 | Shared / QA needs verification | The isolated QA site serves the latest integration SHA after matching green CI, with health and rollback evidence. |
| COW-UX-02 | P0 | Codex / Cowart 本机已验证，待独立 QA | Cowart 单击选择、双击原图、外部点击/Escape 关闭、就地修改、中键/空格平移、框选、右键菜单与文本输入安全。[验收记录](cowart-interaction-acceptance.md)。 |
| COW-E2E-03 | P0 | Unclaimed / blocked on authorized model testing | Real image job completes; new image appears; selection-based edit twice; original image retained; refresh restores assets. |
| COW-BILL-04 | P0 | Unclaimed | Timeout/unknown charge never silently resubmits paid request; errors and recovery visible. |
| COW-LICENSE-05 | P0 | Unclaimed | tldraw license reviewed; no prohibited/warning usage in approved production environment. |
| COW-RELEASE-06 | P1 | Unclaimed | Formal QA, backup, migration and rollback verified before production PR merge. |
| COW-INPUT-07 | P0 | Codex / 本机已验证，待 QA | 空 Holder 填入与比例同步、非空内容保留、逐图综合/造型/配色/风格参考、明确主图及导入图片编辑。[验收记录](cowart-inputs-acceptance.md)。 |

## When picking work
1. Verify Issue and integration PR history first.
2. Record owner, task branch, test plan and files to touch in the Issue.
3. Open a task PR into the integration branch, not directly into `main`.
4. Update row only when status materially changes; link CI and QA evidence in the Issue/PR.
5. Do not call a mock-provider result a real upstream test.
