# Cowart 隔离测试启动与验收

只使用开发分支的代码，不读取正式 `.env`，不挂载正式数据卷，不复用正式镜像标签。

## 启动

在源码目录外创建权限为 `600` 的测试专用环境文件，设置：

- `QA_ENCRYPTION_KEY`：独立随机生成、至少 32 字符。
- `QA_INVITE_CODE`：独立随机测试邀请码。
- `QA_ALLOWED_HOST`：测试 HTTPS 入口的主机名，不带协议、路径或端口（gateway 按主机名校验）。
- `QA_HOST_PORT`：空闲回环端口，默认 `8031`。
- `QA_TLDRAW_LICENSE_KEY`：需要时由操作者配置合法许可。

以下命令中的绝对路径只是占位符；不得使用正式配置文件。

```sh
docker compose --env-file /absolute/path/to/qa.env -p hamoki-cowart-qa -f compose.cowart-qa.yaml config --quiet
docker compose --env-file /absolute/path/to/qa.env -p hamoki-cowart-qa -f compose.cowart-qa.yaml up -d --build --wait --wait-timeout 180
docker compose --env-file /absolute/path/to/qa.env -p hamoki-cowart-qa -f compose.cowart-qa.yaml ps
```

不要与 `compose.yaml` 合并。测试项目名使容器、网络和数据卷独立；测试使用 `hamoki-studio:cowart-qa` 镜像，避免覆盖正式标签。三个必填变量缺失或为空时 Compose 会直接拒绝启动。密钥长度仍由 gateway 验证。

## 健康检查与 HTTPS

镜像已有健康检查，会携带 `APP_ALLOWED_HOST` 请求 `/healthz`。回环诊断也必须带正确 Host：

```sh
curl --fail --show-error -H 'Host: <QA_ALLOWED_HOST>' http://127.0.0.1:8031/healthz
```

预期 `200` 且 JSON 中 `ok: true`。未登录请求 `/cowart/` 预期 `401`，这表示鉴权生效；不是启动失败。登录后预期 `200`。缺少构建产物也会阻止画布正常显示，应检查独立镜像构建结果。

通过现有服务器管理体系创建独立 HTTPS 虚拟主机，反向代理至测试回环端口。保持 `APP_BASE_PATH` 为空，不修改正式站虚拟主机；保留安全 Cookie，通过 HTTPS 注册和登录。不得为了通过检查放宽 Host 或跨域校验。

## 验收记录

逐项记录时间、源码提交、运行环境、HTTP 状态及结果。模拟测试不能代替真实模型验收。

- [ ] Docker 构建成功、容器 healthy、独立数据卷确认。
- [ ] HTTPS `/healthz` 为 200，匿名 Cowart 为 401，测试账号登录后为 200。
- [ ] 两个独立账号的项目和快照隔离；保存、刷新、重新登录后恢复。
- [ ] 用户授权的真实中转站生图：记录任务 ID、状态、回填和刷新恢复，不记录密钥。
- [ ] 选中图片连续自然语言编辑，原图保留，新图避障排列并保存。
- [ ] 超时、失败、重复点击和刷新恢复；不确定计费结果不自动重发。

仅在以上真实验收完成并由用户验收后准备合并和正式部署。

## 本轮检查记录（2026-10-19）

- 已确认开发分支本地及远程提交为 `c95cdc1`。
- gateway 在缺少必填变量时主动退出，现有正式 Compose 默认关闭 Cowart；新增独立 QA Compose，显式启用 Cowart 并要求测试专用变量。
- 当前开发机未发现 Docker CLI，当前会话没有 VPS 管理 MCP；Docker 健康检查与 HTTPS 部署仍待真实执行。
- 首次本机全量测试因系统 `python3` 不可用而失败；该结果不证明服务器或 Docker 中失败。
- 使用已有 Python 运行时补齐本机测试 PATH 后，全量 156 项测试通过，无失败、无跳过；未改动产品的 Python 调用方式。
- Cowart Vite 生产构建成功；QA YAML 结构及独立卷、回环监听、安全 Cookie、预览开关检查通过。Docker Compose 原生校验已加入 CI，本机因无 Docker 未执行。
- 随机测试密钥与独立临时目录启动本机 gateway：`/healthz` 实测 200，匿名 `/cowart/` 实测 401。此结果不是 VPS/Docker 或 HTTPS 验收。
- 本机真实 Chromium 冒烟测试通过：测试账号鉴权进入、项目读取、Studio 面板交互、画布形状保存及刷新恢复；截图已人工查看。页面仍显示 tldraw 许可提示，正式使用前需核实合法许可。
- 提交 `28d1bf8` 的 GitHub CI 已通过 Docker Compose 原生配置校验；完整 CI 结果另行检查，不能将配置校验等同于容器启动验收。
