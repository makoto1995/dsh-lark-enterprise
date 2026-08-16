# dsh-lark-enterprise · DeepSeek Harness 飞书渠道插件（企业 fork）

[![license](https://img.shields.io/badge/license-BSD--3--Clause-blue)](LICENSE)
[![upstream](https://img.shields.io/badge/upstream-dsh--lark--channel-4D6BFE)](https://github.com/omdsh-dev/dsh-lark)

简体中文 | [English](README.en.md)

**dsh-lark-channel 的企业 fork**：把 DeepSeek Harness（DSH）接进飞书/Lark——聊天驱动 Agent、卡片审批、cot 思考过程、多工作区、多 Agent 协作，并新增**公司单机器人场景**所需的**文档授权**能力与**零配置凭据 onboarding**。

---

## 与上游的主要区别

| 维度 | 上游 dsh-lark-channel | 本 fork（dsh-lark-enterprise） |
|---|---|---|
| **文档授权** | ❌ 无 | ✅ **`feishu_share_document`**：bot 创建的文档/表格/文件夹把管理权限（`full_access`）分享给当前聊天对象（单聊用户/群），目标从通道会话 id 自动解析，无需手动传 ID；底层走飞书 OpenAPI 直连授权 |
| **部署配置** | 需配置 `appId`（或扫码创建新应用） | ✅ **零应用配置**：模板不写任何应用标识/凭据；首次启动自动从本机 lark-cli 配置（`~/.lark-cli/config.json`）复用已绑定应用的 appId |
| **凭据 onboarding** | 扫码创建/重新授权，secret 持久化 | ✅ 同机制 + **lark-cli 绑定复用**：有 lark-cli 已绑定应用 → 扫码仅需确认授权；无 → 扫码创建；secret 一律存入 DSH 凭据层（`LARK_APP_SECRET`），settings 只存引用，**后续启动直接复用，不再提示** |
| **平台可移植性** | 配置含应用标识 | ✅ 模板零部署特定值；凭据全走凭据层/环境变量；跨平台（Windows/macOS/Linux）一致 |
| 消息通道 | @larksuite/channel SDK 长连接 | 同左（不变） |
| 卡片 / 审批 / cot / 多工作区 / 多 Agent / 服务化 | ✅ | ✅ 全部保留（不变） |

**一句话**：fork 只做加法——`feishu_share_document`（文档授权）与 `readLarkCliAppId`（lark-cli 绑定复用）两个增量，其余与上游一致，可平滑跟随上游更新。

---

## 快速开始

### 从 GitHub 安装

```sh
# 把本仓库作为 bundle 装进 web profile
dsh plugin --profile web add "github:makoto1995/dsh-lark-enterprise"

# 首次启动：打印二维码 → 扫码确认绑定已有应用（或创建新应用）
dsh web
```

### 本地构建安装

```sh
git clone <your-repo-url>
cd dsh-lark-enterprise
pnpm install && pnpm build && pnpm pack
# 把产物 .tgz 装进 profile
dsh plugin --profile web add ./dsh-lark-enterprise-<version>.tgz
```

> 前置：Node.js `^22.19.0 || >=24`、DeepSeek Harness（`npm i -g @deepseek-ai/dsh`）、飞书/Lark 租户。

### 凭据流程（零配置）

1. **首次启动**：插件读取本机 lark-cli 绑定（`~/.lark-cli/config.json`）复用 appId，打印二维码；
2. **扫码**：确认绑定已有应用（或创建新应用），secret 自动存入 DSH 凭据层（`LARK_APP_SECRET`），settings 仅记录引用；
3. **之后启动**：直接复用本地持久化配置，不再出现 onboarding。

> 不装 lark-cli 也可以：首次启动同样走扫码流程（创建新应用），secret 照常持久化。

---

## 文档授权（企业版核心新增）

公司统一机器人场景：bot 以应用身份创建的文档归 bot 所有，必须显式授权聊天对象才能访问。

```text
帮我创建一个周报文档，然后分享给我
```

Agent 创建文档后调用 `feishu_share_document`（`token` + `type`），自动把 `full_access` 授予当前聊天对象：

| 会话粒度 | 授权目标 |
|---|---|
| 单聊（chat-sender） | 该用户（openid） |
| 群聊（chat） | 整个群（openchat） |
| 话题（chat-thread） | 回退授权给所在会话 |

配置（`cordis.patch.yml` 的 `lark-channel` 行）：

| 配置 | 默认 | 说明 |
|---|---|---|
| `shareEnabled` | true | 是否给 chat agent 提供该工具 |
| `sharePerm` | full_access | 默认权限角色（view/edit/full_access），模型可每次覆盖 |

前置：飞书开发者后台为应用开通 `docs:permission.member:create` + 资源 scope（`drive:drive` / `docs:doc` / `sheets:spreadsheet` / `bitable:app` 等）。

---

## 完整能力（与上游一致）

- **持久会话**：重启恢复，`/new` 原地重开；
- **多工作区**：`/ws` 查看、`/cd` 切换；
- **模型切换**：`/model` 卡片选择，按会话记忆；
- **原生执行过程**：cot 思考过程 + 最终答案单独发送（老客户端可用 `output: 'stream'`）；
- **人机协作卡片**：提问、计划审批、工具审批；
- **会话隔离**：`chat` / `chat-thread` / `chat-sender` 三级；
- **多 Agent 协作**：多机器人群聊 @ 交接，`botHops` 轮次上限；
- **斜杠命令**：`/status` `/new` `/stop` `/help` + 宿主命令透传；
- **服务化**：macOS/systemd 用户级后台服务（`dsh-lark-channel status/logs/restart/stop`）；
- **断线自愈**：WebSocket 限额退避自动重建。

## 环境要求

- Node.js `^22.19.0 || >=24`
- DeepSeek Harness `0.1.0-rc.6` 或更新
- 飞书或 Lark 租户（cot 原生思考过程需飞书 PC 7.70 / 移动端 7.74+）

## 开发

```sh
pnpm install
pnpm test
pnpm typecheck
pnpm build
```

## License

[BSD-3-Clause](LICENSE)，保留上游 [dsh-lark-channel](https://github.com/omdsh-dev/dsh-lark) 版权声明。

本项目是非官方社区插件，与 DeepSeek、飞书或 Lark 不存在隶属、授权或背书关系。
