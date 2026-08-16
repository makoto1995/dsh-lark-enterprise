# dsh-lark-enterprise · DeepSeek Harness Feishu/Lark channel plugin (Enterprise fork)

[![license](https://img.shields.io/badge/license-BSD--3--Clause-blue)](LICENSE)
[![upstream](https://img.shields.io/badge/upstream-dsh--lark--channel-4D6BFE)](https://github.com/omdsh-dev/dsh-lark)

English | [简体中文](README.md)

**Enterprise fork of dsh-lark-channel**: bridge DeepSeek Harness (DSH) into Feishu/Lark — chat-driven agents, card approvals, cot output, multi-workspace, multi-agent — plus **document sharing** and **zero-config credential onboarding** for single-bot company deployments.

---

## Key differences from upstream

| Aspect | Upstream dsh-lark-channel | This fork (dsh-lark-enterprise) |
|---|---|---|
| **Document sharing** | ❌ | ✅ **`feishu_share_document`**: share `full_access` of bot-created docs/tables/folders to the current chat counterpart (DM user or group); target resolved from the channel session id automatically; direct Feishu OpenAPI authorization |
| **Deployment config** | Requires `appId` (or QR-create a new app) | ✅ **Zero app config**: no app identifiers/credentials in templates; on first boot the bound app id is reused from the local lark-cli config (`~/.lark-cli/config.json`) |
| **Credential onboarding** | QR create/re-authorize, secret persisted | ✅ Same flow + **lark-cli binding reuse**: bound app → QR just confirms authorization; secret always stored in the DSH credentials seam (`LARK_APP_SECRET`), settings keep only the reference; **later boots reuse local state with no prompt** |
| **Portability** | Config carries app identifiers | ✅ Templates carry zero deployment-specific values; credentials via credentials seam/env; consistent across Windows/macOS/Linux |
| Messaging channel | @larksuite/channel SDK long connection | Same (unchanged) |
| Cards / approvals / cot / workspaces / multi-agent / service mgmt | ✅ | ✅ All kept (unchanged) |

**In one line**: this fork only adds — `feishu_share_document` (document sharing) and `readLarkCliAppId` (lark-cli binding reuse); everything else matches upstream and can follow upstream updates smoothly.

---

## Quick start

### Install from GitHub

```sh
# Install this repo as a bundle into the web profile
dsh plugin --profile web add "github:makoto1995/dsh-lark-enterprise"

# First boot prints a QR: scan to confirm binding an existing app (or create one)
dsh web
```

### Build and install locally

```sh
git clone <your-repo-url>
cd dsh-lark-enterprise
pnpm install && pnpm build && pnpm pack
dsh plugin --profile web add ./dsh-lark-enterprise-<version>.tgz
```

> Prereqs: Node.js `^22.19.0 || >=24`, DeepSeek Harness (`npm i -g @deepseek-ai/dsh`), a Feishu/Lark tenant.

### Credential flow (zero config)

When the composition carries no `appId`, the plugin guides the operator by environment (guidance is printed to the operator console; the QR scan always remains the fallback):

1. **lark-cli not installed** → prompt: `npm i -g @larksuite/cli && lark-cli config init --new` to install and create/bind an app (or scan the QR to create one directly);
2. **lark-cli installed but no app bound** → prompt: run `lark-cli config init --new` to create and bind an app (or scan the QR to create one directly);
3. **App bound** (`~/.lark-cli/config.json`) → appId reused automatically;
   - secret already in the credentials seam (`LARK_APP_SECRET`) → starts directly;
   - no secret → QR printed; scanning confirms authorization of that app, and the secret is stored in the credentials seam;
4. **Later boots**: reuse the persisted local state, no onboarding prompt.

> lark-cli is optional: without it, the QR flow works too (creates a new app) and persists the secret the same way.

---

## Document sharing (enterprise addition)

With a single company bot, documents the bot creates belong to the bot and must be explicitly shared with the chat counterpart:

```text
Create a weekly report document and share it with me
```

The agent creates the document and calls `feishu_share_document` (`token` + `type`), which grants `full_access` to the current chat counterpart:

| Session scope | Grant target |
|---|---|
| DM (chat-sender) | the user (openid) |
| Group (chat) | the whole group (openchat) |
| Thread (chat-thread) | falls back to the containing chat |

Config (in the `lark-channel` row of `cordis.patch.yml`):

| Key | Default | Meaning |
|---|---|---|
| `shareEnabled` | true | provide the tool to chat agents |
| `sharePerm` | full_access | default role (view/edit/full_access); the model may override per call |

Prereq: grant the app `docs:permission.member:create` plus resource scopes (`drive:drive` / `docs:doc` / `sheets:spreadsheet` / `bitable:app`, etc.) in the Feishu developer console.

---

## Full capabilities (same as upstream)

- **Persistent sessions**: resume after restart; `/new` restarts in place;
- **Multi-workspace**: `/ws` list, `/cd` switch;
- **Model switching**: `/model` picker card, remembered per chat;
- **Native process view**: cot thinking process + final answer sent separately (use `output: 'stream'` on older clients);
- **Human-in-the-loop cards**: questions, plan reviews, tool approvals;
- **Session isolation**: `chat` / `chat-thread` / `chat-sender`;
- **Multi-agent collaboration**: several bots in one group hand turns via @, bounded by `botHops`;
- **Slash commands**: `/status` `/new` `/stop` `/help` + host command passthrough;
- **Service management**: user-level background service on macOS/systemd (`dsh-lark-channel status/logs/restart/stop`);
- **Self-healing**: quota-and-backoff WebSocket reconnect.

## Requirements

- Node.js `^22.19.0 || >=24`
- DeepSeek Harness `0.1.0-rc.6` or newer
- Feishu or Lark tenant (native cot requires Feishu PC 7.70 / mobile 7.74+)

## Development

```sh
pnpm install
pnpm test
pnpm typecheck
pnpm build
```

## License

[BSD-3-Clause](LICENSE), retaining the upstream [dsh-lark-channel](https://github.com/omdsh-dev/dsh-lark) copyright notice.

This is an unofficial community plugin with no affiliation, endorsement, or backing from DeepSeek, Feishu, or Lark.
