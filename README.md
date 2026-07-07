# fasten-share-client

Next.js Node 客户端承担生产者守护进程和本地配置 UI：

- 连接 `fasten-share-server` 的 `/ws/producer`；
- 注册时仅发送 JWT 和 offerings，稳定 producerId 由服务端按账号查询或签发；
- 公布健康后端和模型；
- 通过协议 v3 二进制 WS frame 流式接收请求、注入本地后端密钥并返回响应；
- 通过服务端 REST API 搜索模型并生成中心化消费地址；
- 在消费者节点列表中关注生产者、查看最近三个月均分，并提交每月一次的 0.5–5 分半星评价；关注列表同步展示生产者的三个月均分；
- 分别展示消费积分和生产积分；不兼容旧版单一 `balance` 字段。

消费者模型流量不经过本地 Next.js 服务。

```bash
FS_SERVER_HTTP_URL=http://localhost:8080 npm run dev
```
