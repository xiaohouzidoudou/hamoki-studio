## v0.6.4 Capability Routing

- Per-user text/image/vision capability bindings to independent provider+model.
- Per-capability override of API base URL and API Key (encrypted at rest, redacted from API).
- Text chat API and UI mode, provider model fetch by capability.
- Legacy v0.6.3 providers and projects preserved without destructive migrations.

# Hamoki Studio 更新记录

## V0.6.3 · 极简账号与故障日志

- 固定邀请码 `hamoki` 注册用户名、密码；登录、退出；30 天持久安全 Cookie，重启保持登录。
- 账号独立项目、图像、历史、任务和 AES-GCM 中转站 Key，原匿名/旧单人数据隔离保留。
- 每账号 1GB、全站新账号数据 5GB；旧缩略图及旧作品自动清理，仅操作当前账号；不可清理时拒绝写入。
- 左侧「查看日志」按钮：当前账号独立诊断日志、刷新、复制、清空；上游测试失败、排队任务失败、HTTP 错误和前端异常记录，落盘脱敏且最多 160 条。
- 上游 AI 协议适配器没有修改；真实付费请求待人工调试。

## V0.6.2 · 浏览器免登录工作区（历史版）

- 按浏览器 Cookie 隔离项目和 Key；本版本升级后不再自动向新账号开放旧匿名数据。

## v0.6.5 · Continuous Text Conversations

- Per-account, per-project multi-turn text history for chat (last 24 turns with bounded context size); no automatic exposure of image assets or prompts.
- Genuine upstream OpenAI-compatible and Gemini SSE streaming, proxy-safe SSE forwarding and browser progressive rendering with a stop button.
- Abort/error requests do not persist partial messages; completed chat pairs are saved to the original projects store.
- Compatibility: old POST /api/chat retained and now supports context. All V0.6.4 image/vision provider routes untouched.
- Added mock-provider integration tests for UTF-8 streaming, separate projects/accounts, provider error, multi-turn history and non-stream backward compatibility.
