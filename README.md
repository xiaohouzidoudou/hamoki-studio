# Hamoki Studio 自由画布 · 正式版 V1

2026-11-06 封版。以当天本地自由画布的实际源码为基线，不包含运行数据、个人图片、API Key、测试版 backend-v2。

## 运行

使用独立 HTTPS 域名及反向代理，容器仅绑定 127.0.0.1:8030。启动前私下创建 .env，至少提供 APP_ALLOWED_HOST 和 32 位以上 APP_ENCRYPTION_KEY。不要将 .env、数据卷或其他账号内容提交到 GitHub。

docker compose up -d --build

现有用户数据必须独立保留，不用此代码包覆盖原来的 Docker 数据卷。此版本运行 server.js；backend-v2 属于尚未完成联调的实验后端，不随正式版打包。功能迭代以后另开版本。

## 版本边界

此版本前端含自由画布、图片操作、生成队列、提示词历史、框选分组和玻璃质感界面。生产验收需确认真实 AI 接口和登录数据格式；软件包本身不包含任何 API Key。
