# Fasten Share Client

[English](./README.md) | 中文

Fasten Share Client 是 Fasten Share 的开源本地客户端。它提供浏览器控制台和本地 Node.js 生产者进程，你可以用它：

- 作为生产者共享自己的本地或在线模型后端；
- 作为消费者搜索共享出来的模型节点；
- 生成兼容工具和 API 客户端的服务调用地址；
- 将上游 API Key 保存在自己的机器上，而不是发送给其他用户。

如果你只是想安装桌面端，建议直接从桌面端发布页下载：

- 桌面端发布页：<https://github.com/fasten-share/fasten-share-desktop/releases>

## 你可以用它做什么

### 使用别人共享的模型节点

作为消费者，你可以按模型名或协议搜索在线生产者，选择消费者 API Key，然后复制生成的服务地址，配置到兼容 OpenAI / Anthropic 风格接口的工具或客户端中。工具配置助手也会检测并清理可能覆盖 API Key 的 OAuth 登录状态；文件型凭证会随原配置一起备份。Claude、Codex、OpenCode、OpenClaw 和 Hermes 的生成配置均锁定为仅使用 API Key，不会回退到 OAuth provider。

消费者模型流量走的是 UI 中复制的 Fasten Share 服务端地址，不经过本地 Next.js 页面。

### 共享自己的模型后端

作为生产者，你可以发布这些后端：

- 本地 Ollama、LM Studio、vLLM 或其他 OpenAI 兼容服务；
- 在线 OpenAI 兼容或 Anthropic 兼容接口；
- Azure OpenAI 风格部署，前提是正确配置 API Version。

客户端会主动连接 Fasten Share 服务端的生产者 WebSocket，执行健康检查，并将流式请求转发到你配置的后端。

### 密钥保存在本机

共享后端时，上游 API Key / Token 会保存在你的机器上，并在本地转发请求时注入到后端请求中。请只在你确认有权共享的情况下发布后端，并自行确认相关模型服务商条款。

## 推荐使用方式

大多数用户建议使用桌面端：

<https://github.com/fasten-share/fasten-share-desktop/releases>

桌面端封装了本客户端，对 Windows 和 macOS 用户更友好。Linux 用户可以直接运行本客户端，或参考本仓库的最新说明。

## 从源码运行

要求：

- 安装符合本项目要求的 Node.js；
- 可以访问一个 Fasten Share 服务端地址；
- 如果你要作为生产者，还需要一个本地或在线模型后端。

普通客户使用时，建议运行生产构建，不要使用开发服务器：

```bash
npm install
npm run build
npm run start
```

然后打开：

```text
http://localhost:8086
```

默认本地端口：

- UI：`8086`
- 本地状态 WebSocket：`8087`

如果是服务器部署或长期运行，通常更推荐使用 Docker Compose。见 [Docker](#docker)。

> 维护者提示：如果你在本仓库的 WSL 环境中工作，请遵循本地项目说明，不要在 WSL 中运行 npm 命令。

## 配置

客户端通常可以直接在 UI 中配置；同时也支持环境变量，方便本地开发或无头生产者部署。

### 服务连接

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `FS_WS_PORT` | 本地浏览器状态 WebSocket 端口 | `8087` |
| `FS_WS_HOST` | 本地浏览器状态 WebSocket 监听地址 | `127.0.0.1` |
| `FS_DATA_DIR` | 本地客户端配置目录 | `~/.fasten-share` |
| `FS_CREDENTIAL_KEY` | 多账号凭据加密主密钥；桌面端由系统安全存储提供 | 自动生成本机受限密钥文件 |

客户端最多同时保存并运行 5 个已登录账号。各账号的后端、上游 API Key、自动共享设置和生产连接相互隔离；切换当前账号不会停止其他账号后台共享。退出账号会删除登录凭据并停止该账号连接，但保留配置供重新登录后恢复。V2 多账号存储不会读取或迁移旧版单账号配置。

### 生产者后端初始化

单后端环境变量：

| 变量 | 说明 |
| --- | --- |
| `FS_BACKEND_BASEURL` | 后端基础 URL，不包含 API 版本路径 |
| `FS_BACKEND_APIKEY` | 后端 API Key / Token，本地后端可为空 |
| `FS_BACKEND_PROTOCOL` | 协议，例如 `openai`、`anthropic` 或 `azure-openai` |
| `FS_BACKEND_APIVERSION` | Azure OpenAI 需要的 API Version |
| `FS_BACKEND_VERSION_PREFIX` | peer id 后继续转发的版本前缀，例如 `/v1` |
| `FS_BACKEND_MODELS` | 用逗号分隔的模型名称，用于搜索发现 |
| `FS_BACKEND_COST_MULTIPLIER` | 积分消耗倍率 |
| `FS_BACKEND_MAX_CONCURRENCY` | 最大并发生产请求数 |

多后端可以使用 `FS_BACKENDS`，值为后端对象数组的 JSON 字符串。UI 会把规范化后的后端 ID 和配置持久化到 `FS_DATA_DIR`。

## Docker

仓库内包含 Docker Compose 配置，可用于独立运行客户端服务：

```bash
docker compose up -d --build
```

然后打开：

```text
http://localhost:8086
```

使用 Docker Compose 部署前，请检查 compose 文件，并将服务端地址改成你的真实 Fasten Share 服务端地址。

## 开发

只有在修改客户端源码时，才建议使用开发服务器：

```bash
npm install
npm run dev
```

开发服务器使用同一个本地 UI 端口（`8086`），但不推荐普通用户用它来长期运行客户端。

## 典型生产者流程

1. 登录客户端。
2. 打开生产者 / 共享页面。
3. 添加一个后端。
4. 填写后端基础 URL，不要包含 API 版本路径。
5. 选择协议和版本前缀。
6. 填写用于搜索发现的模型名称。
7. 设置并发数和积分倍率。
8. 保存并开始共享。

本地 Ollama 示例：

| 字段 | 示例 |
| --- | --- |
| 基础 URL | `http://localhost:11434` |
| 协议 | 如果通过兼容接口暴露，则选择 OpenAI 兼容预设 |
| API Key | 本地后端不需要鉴权时可留空 |
| 模型 | `llama3.1`、`qwen2.5` 或你的本地模型名 |

协议相关示例请参考应用内的 base URL 填写指引。

## 典型消费者流程

1. 登录客户端。
2. 创建或选择一个消费者 API Key。
3. 按模型名或协议搜索模型节点。
4. 选择一个生产者节点。
5. 复制生成的服务地址，或使用工具配置助手。
6. 将该地址配置到兼容客户端或 AI 工具中使用。

## 积分、评价和关注

客户端会分别展示消费积分和生产积分。它也支持关注生产者、查看最近三个月均分，并按月提交评分，帮助消费者判断生产者质量。

## 安全提示

- 生产者上游 API Key 设计上保存在生产者本机。
- 生成的消费者 API Key 也应视为敏感信息。
- 共享模型后端或账号额度属于你的自主行为，可能违反模型服务商条款。
- 请始终使用可信的 Fasten Share 服务端地址。
- 如果发现密钥泄露、异常使用或服务商条款风险，请立即停止共享。

## 项目结构

```text
app/                 Next.js 页面、API 路由和 UI 组件
lib/client/          浏览器 / 客户端辅助逻辑
lib/server/          本地 Node 生产者、配置、协议和工具辅助逻辑
lib/i18n/            英文和中文 UI 文案
public/              静态资源
```

## 许可证

本仓库基于 MIT License 开源，详见 [LICENSE](./LICENSE)。
