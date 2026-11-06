# Hamoki Studio · Sub2 统一登录网关

此目录包含 Node.js 24 / Fastify / SQLite 的生产账号网关，继续使用原有自由画布前端。Studio **不再提供**本地密码、注册码、管理员激活码或重置密码服务。所有有效会话都必须绑定经 Sub2 验证的账号。

## 部署

- Node.js 24+：`npm ci`，然后 `node src/index.ts`。
- 默认只监听 `127.0.0.1:8048`；HTTPS 由可信反向代理提供。
- 环境变量：`STUDIO_PORT`、`STUDIO_HOST`、`STUDIO_DATA_DIR`、`STUDIO_SECURE_COOKIES=1`、`SUB2_BASE_URL`。
- **管理员**：`STUDIO_ADMIN_SUB2_ID` 应由运维人员在 Sub2 的权威数据库中验证后配置成管理员的数字 ID。没有此配置就不授予任何人管理员角色，**绝不把首个登录的人自动升级**。
- 与 Sub2 共用宿主机时可使用 `SUB2_BASE_URL=http://127.0.0.1:<port>`。请确保网关只监听回环地址，不要将 Sub2 的登录接口对外开放。
- 私人数据保存在 `STUDIO_DATA_DIR` 中。`accounts.sqlite`（含 WAL）、`master.key`、用户目录要一起备份；绝不可提交到公开仓库。

## 身份认证与账户隔离

- `/login` 只有 Sub2 邮箱和密码。账号核实后由 Sub2 返回的用户 ID 创建 Studio 身份；用户无需在 Studio 注册第二次，也无需输入激活码。
- 当 Sub2 启用了 Cloudflare Turnstile 时，Studio 从 Sub2 公共设置读取站点 Key，登录页面显示相同验证码并把 `turnstile_token` 一并传给 Sub2。需在该 Turnstile widget 的允许域名中包含 Studio 正式域名，否则验证码无法签发；不要关闭 Sub2 的防护来绕过问题。
- Sub2 密码仅用于身份验证请求，不持久化；服务器保存加密的访问令牌、刷新令牌、专属生图 Key。
- 每个 Studio 账号使用独立本地 Node worker，`data/users/<id>` 私有目录和独立的服务商配置，每位用户图片与预览占用上限 1 GiB。
- 旧 Studio 本地账号即使保留 SQLite 会话，现也无法登录。旧激活资料不再使用，数据暂保留以便回滚。
- 管理员可查看用户和暂时禁用/恢复 Studio 访问；密码管理都在 Sub2 进行。
- 由于浏览器同源限制，Sub2 站点已有 Cookie 不能当作 Studio 登录凭证，仍须用 Sub2 登录入口验证一次账号。

## 生图与 API

- 余额实时查询 Sub2；登录后尝试创建并绑定每用户专用 Key、读取其可见模型。
- 原自由画布队列 `/api/jobs` 非阻塞创建任务，保留 429 限流有限重试和 504/524 可能扣费不自动重试提示。
- 独立 `/api/account/sub2/jobs` 保存每账号 `requestId` 的持久化账本，不确定上游请求不自动重新发付费调用。**旧画布队列尚未完全迁移到 Sub2 异步账本**；上游异步协议与真实扣费需要用户授权下另行联调。

## 测试

运行 `npm test`（Node 24），验证唯一登录、管理员固定 ID、旧账号失效、个人空间隔离、禁用、Sub2 模拟 Key 和余额、任务幂等及 SSRF 防护。
