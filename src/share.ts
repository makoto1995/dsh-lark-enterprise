/**
 * feishu_share_document —— 把 bot 拥有的飞书文档/表格/多维表格/文件夹等资源的
 * 管理权限（full_access）分享给当前飞书聊天对象（单聊用户或群）。
 *
 * 公司单机器人场景：租户内只有一个飞书应用（bot），bot 以应用身份创建的文档
 * 归 bot 所有，必须显式授权给聊天里的用户/群，对方才能访问。本工具由 chat
 * agent 在对话中调用，目标聊天对象直接从通道的会话 id（`lark-<conversationKey>`）
 * 解析，无需手动传 ID。
 *
 * 底层走 lark-cli（`drive permission.members create`）：通道本体用
 * @larksuite/channel SDK，但 drive 权限管理不在该 SDK 范围内，而 lark-cli
 * 已覆盖且命令链路经实测验证。lark-cli 为可选前置（见 README）。
 * @module dsh-lark-enterprise/share
 */

import { execFileSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ResolvedConfig } from './config.ts'

/** 文档类型白名单（drive permission.members create 的 params.type）。 */
const DOC_TYPES = [
  'doc', 'docx', 'sheet', 'file', 'wiki', 'bitable', 'folder', 'mindnote', 'minutes', 'slides',
] as const

/** 权限角色。 */
const PERMS = ['view', 'edit', 'full_access'] as const

/** 会话 id 前缀（与 src/session.ts 的 SESSION_PREFIX 一致）。 */
const SESSION_PREFIX = 'lark-'

/**
 * 探测 lark-cli 的 node 入口：@larksuite/cli/scripts/run.js。
 * 直接探测已知 npm 全局安装位置（Windows 上 execFileSync('npm') 会因 npm 是
 * .cmd 而 ENOENT），最后兜底 `npm root -g`（Windows 用 npm.cmd + shell）。
 */
export function resolveLarkCliEntry(config: ResolvedConfig): string {
  if (config.shareLarkCliEntry) return config.shareLarkCliEntry
  const home = homedir()
  const candidates = [
    join(home, 'AppData', 'Roaming', 'npm', 'node_modules', '@larksuite', 'cli', 'scripts', 'run.js'),
    join(home, '.npm-global', 'node_modules', '@larksuite', 'cli', 'scripts', 'run.js'),
    '/usr/local/lib/node_modules/@larksuite/cli/scripts/run.js',
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  try {
    const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm'
    const root = execFileSync(npmBin, ['root', '-g'], {
      encoding: 'utf8',
      windowsHide: true,
      shell: process.platform === 'win32',
    }).trim()
    const candidate = join(root, '@larksuite', 'cli', 'scripts', 'run.js')
    if (existsSync(candidate)) return candidate
  } catch {
    // 调用方会告警
  }
  return ''
}

/** 单次 lark-cli 调用：node <entry> <args...>。无 shell，规避引号/注入问题。 */
export function runLarkCli(entry: string, args: readonly string[], timeoutMs = 120000): Promise<{ stdout: string, stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    const cap = 1024 * 1024
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk
      if (stdout.length > cap) stdout = stdout.slice(-cap)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk
      if (stderr.length > cap) stderr = stderr.slice(-cap)
    })
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`lark-cli timeout after ${timeoutMs}ms: ${args.join(' ')}`))
    }, timeoutMs)
    child.on('error', (error: Error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve({ stdout, stderr })
      else reject(new Error(`lark-cli exited ${code}: ${args.join(' ')}\n${stderr.slice(-2000)}`))
    })
  })
}

/** 授权目标：协作者类型 + ID + 协作者角色类型。 */
export interface ShareTarget {
  member_type: 'openid' | 'openchat' | 'unionid' | 'userid' | 'email' | 'opendepartmentid'
  member_id: string
  type: 'user' | 'chat' | 'department'
}

/**
 * 从通道会话 id 反推聊天对象。会话 id 形如：
 * - `lark-oc_xxx`（sessionScope=chat，群或 p2p 会话）→ 授权给整个会话（openchat）；
 * - `lark-oc_xxx:ou_yyy`（chat-sender）→ 授权给该成员（openid）；
 * - `lark-oc_xxx:omt_zzz`（chat-thread）→ 话题无法直接授权，回退到会话（openchat）；
 * - 可能带 epoch 后缀 `--eN`（/new 派生），解析时剥离。
 * 非本通道会话（其他 UI 创建的 session）返回 null，由调用方要求显式传参。
 */
export function targetFromSession(sessionId: string | undefined): ShareTarget | null {
  if (typeof sessionId !== 'string' || !sessionId.startsWith(SESSION_PREFIX)) return null
  const key = sessionId
    .slice(SESSION_PREFIX.length)
    .replace(/--e\d+$/u, '')
  const parts = key.split(':')
  const chatId = parts[0]
  if (!chatId) return null
  const facet = parts[1]
  if (facet !== undefined && facet.startsWith('ou_')) {
    return { member_type: 'openid', member_id: facet, type: 'user' }
  }
  return { member_type: 'openchat', member_id: chatId, type: 'chat' }
}

/** 显式参数覆盖目标（非本通道会话或用户主动指定时）。 */
export function targetFromArgs(args: Record<string, unknown>): ShareTarget | null {
  const memberId = args.member_id
  const memberType = args.member_type
  if (typeof memberId !== 'string' || memberId === '' || typeof memberType !== 'string') return null
  if (memberType === 'openchat') return { member_type: 'openchat', member_id: memberId, type: 'chat' }
  if (memberType === 'opendepartmentid') return { member_type: 'opendepartmentid', member_id: memberId, type: 'department' }
  if (memberType === 'openid' || memberType === 'unionid' || memberType === 'userid' || memberType === 'email') {
    return { member_type: memberType, member_id: memberId, type: 'user' }
  }
  return null
}

/**
 * 执行一次授权：drive permission.members create（high-risk-write，带 --yes）。
 * @returns 用户可读的结果。
 */
export async function performShare(config: ResolvedConfig, target: ShareTarget, token: string, type: string, perm: string): Promise<{ ok: boolean, message: string }> {
  const entry = resolveLarkCliEntry(config)
  if (entry === '') {
    return { ok: false, message: '未找到 lark-cli（@larksuite/cli）：请安装并在 shareLarkCliEntry 配置入口路径' }
  }
  const data = { member_type: target.member_type, member_id: target.member_id, perm, type: target.type }
  try {
    await runLarkCli(entry, [
      'drive', 'permission.members', 'create',
      '--params', JSON.stringify({ token, type }),
      '--data', JSON.stringify(data),
      '--yes',
      '--as', 'bot',
    ])
    return { ok: true, message: `已将 ${type}(${token}) 的 ${perm} 权限授予 ${target.member_type}=${target.member_id}` }
  } catch (error) {
    return { ok: false, message: `授权失败：${String(error)}` }
  }
}

/**
 * 工具定义（shadow 形式，与 src/questions.ts 的 shadowQuestionTool 同构：
 * compiled JSON Schema + execute，不依赖宿主 defineTool）。
 * @param config - 已解析配置（shareEnabled / sharePerm / shareLarkCliEntry）。
 */
export function shareDocumentTool(config: ResolvedConfig): object {
  return {
    name: 'feishu_share_document',
    description:
      '把 bot 拥有的飞书文档/表格/多维表格/文件夹等资源的管理权限（full_access）分享给当前飞书聊天对象'
      + '（单聊用户或群）。在飞书会话中调用时自动推导目标；非飞书会话需显式传 member_id/member_type。'
      + '文档必须由 bot 创建（或 bot 拥有管理权）。',
    parameters: {
      type: 'object',
      required: ['token', 'type'],
      properties: {
        token: { type: 'string', description: '云文档 token（bot 创建资源时的返回值；wiki 链接需先解包出 obj_token）' },
        type: { type: 'string', enum: [...DOC_TYPES], description: '云文档类型，与 token 匹配' },
        perm: { type: 'string', enum: [...PERMS], default: 'full_access', description: '权限角色（默认 full_access=可管理）' },
        member_id: { type: 'string', description: '可选：目标协作者 ID（open_id/chat_id），缺省从当前飞书会话推导' },
        member_type: {
          type: 'string',
          enum: ['openid', 'openchat', 'unionid', 'userid', 'email', 'opendepartmentid'],
          description: '可选：member_id 的类型，缺省从当前飞书会话推导',
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['ok', 'message'],
        properties: {
          ok: { type: 'boolean', description: '是否成功' },
          message: { type: 'string', description: '结果说明' },
        },
      },
      render: (_args: unknown, value: unknown) => {
        const v = value as { message?: unknown } | null | undefined
        return [{ type: 'text', text: typeof v?.message === 'string' ? v.message : JSON.stringify(value) }]
      },
    },
    async execute(args: unknown, exec: unknown): Promise<{ ok: boolean, message: string }> {
      const supplied = (args as Record<string, unknown> | null | undefined) ?? {}
      const token = supplied.token
      const type = supplied.type
      if (typeof token !== 'string' || token === '' || typeof type !== 'string' || type === '') {
        return { ok: false, message: '参数错误：token 与 type 必填（type: docx/sheet/bitable/folder 等）' }
      }
      const perm = typeof supplied.perm === 'string' && (PERMS as readonly string[]).includes(supplied.perm)
        ? supplied.perm
        : config.sharePerm
      const sessionId = (exec as { agent?: { session?: { id?: unknown } } } | null | undefined)?.agent?.session?.id
      const target = targetFromArgs(supplied) ?? targetFromSession(typeof sessionId === 'string' ? sessionId : undefined)
      if (target === null) {
        return {
          ok: false,
          message: '无法推导目标聊天对象：请在本工具的 member_id/member_type 参数里显式指定（openid=用户 / openchat=群）',
        }
      }
      return await performShare(config, target, token, type, perm)
    },
    presentCall: (args: unknown) => {
      const a = args as Record<string, unknown> | null | undefined
      return {
        card: 'generic',
        title: 'Share Feishu document',
        kind: 'other',
        rawInput: { token: a?.token, type: a?.type, perm: a?.perm ?? config.sharePerm },
      }
    },
  }
}
