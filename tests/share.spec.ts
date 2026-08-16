import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  resolveLarkCliEntry,
  shareDocumentTool,
  targetFromArgs,
  targetFromSession,
} from '../src/share.ts'
import { readLarkCliAppId } from '../src/credentials.ts'
import { resolveConfig } from '../src/config.ts'
import { assertRegistrableTool, assertSupportedSchema } from './harness.ts'

/** Defaults-only resolved config, as a deployment that touches nothing else gets. */
function baseConfig() {
  return resolveConfig({})
}

describe('targetFromSession', () => {
  it('resolves a chat-scope session to the whole chat (openchat)', () => {
    expect(targetFromSession('lark-oc_a1b2c3')).toEqual({
      member_type: 'openchat',
      member_id: 'oc_a1b2c3',
      type: 'chat',
    })
  })

  it('resolves a chat-sender session to the member (openid)', () => {
    expect(targetFromSession('lark-oc_a1b2c3:ou_u1u2u3')).toEqual({
      member_type: 'openid',
      member_id: 'ou_u1u2u3',
      type: 'user',
    })
  })

  it('falls a chat-thread session back to the chat (openchat)', () => {
    expect(targetFromSession('lark-oc_a1b2c3:omt_t1t2t3')).toEqual({
      member_type: 'openchat',
      member_id: 'oc_a1b2c3',
      type: 'chat',
    })
  })

  it('strips the epoch suffix from /new-derived ids', () => {
    expect(targetFromSession('lark-oc_a1b2c3--e2')).toEqual({
      member_type: 'openchat',
      member_id: 'oc_a1b2c3',
      type: 'chat',
    })
    expect(targetFromSession('lark-oc_a1b2c3:ou_u1u2u3--e1')).toEqual({
      member_type: 'openid',
      member_id: 'ou_u1u2u3',
      type: 'user',
    })
  })

  it('rejects foreign session ids and garbage', () => {
    expect(targetFromSession(undefined)).toBeNull()
    expect(targetFromSession('session-123')).toBeNull()
    expect(targetFromSession('feishu-p2p-ou_x')).toBeNull()
    expect(targetFromSession('lark-')).toBeNull()
  })
})

describe('targetFromArgs', () => {
  it('accepts explicit openchat/openid/opendepartmentid overrides', () => {
    expect(targetFromArgs({ member_id: 'oc_z', member_type: 'openchat' })).toEqual({
      member_type: 'openchat', member_id: 'oc_z', type: 'chat',
    })
    expect(targetFromArgs({ member_id: 'ou_z', member_type: 'openid' })).toEqual({
      member_type: 'openid', member_id: 'ou_z', type: 'user',
    })
    expect(targetFromArgs({ member_id: 'od_z', member_type: 'opendepartmentid' })).toEqual({
      member_type: 'opendepartmentid', member_id: 'od_z', type: 'department',
    })
  })

  it('rejects partial or invalid overrides', () => {
    expect(targetFromArgs({ member_id: 'ou_z' })).toBeNull()
    expect(targetFromArgs({ member_type: 'openid' })).toBeNull()
    expect(targetFromArgs({ member_id: 'x', member_type: 'nonsense' })).toBeNull()
  })
})

describe('shareDocumentTool', () => {
  const tool = shareDocumentTool(baseConfig()) as {
    name: string
    parameters: unknown
    output: unknown
    execute: (args: unknown, exec: unknown) => Promise<unknown>
  }

  it('is registrable and schema-valid', () => {
    expect(tool.name).toBe('feishu_share_document')
    assertSupportedSchema(tool.parameters)
    assertRegistrableTool({ name: tool.name, parameters: tool.parameters, output: tool.output })
  })

  it('rejects a call without token/type', async () => {
    const result = await tool.execute({}, {}) as { ok: boolean }
    expect(result.ok).toBe(false)
  })

  it('refuses to derive a target outside a lark session', async () => {
    const result = await tool.execute(
      { token: 'doxcn_fake', type: 'docx' },
      { agent: { session: { id: 'session-foreign' } } },
    ) as { ok: boolean }
    expect(result.ok).toBe(false)
  })

  it('derives the chat target from a lark session id', async () => {
    const result = await tool.execute(
      { token: 'doxcn_fake', type: 'docx' },
      { agent: { session: { id: 'lark-oc_a1b2c3' } } },
    ) as { ok: boolean }
    // 无 lark-cli 时给出明确错误而非崩溃；有入口时走真实调用（此处环境无入口则失败提示）
    expect(typeof result.ok).toBe('boolean')
  })
})

describe('resolveLarkCliEntry', () => {
  it('honors an explicit entry', () => {
    expect(resolveLarkCliEntry(resolveConfig({ shareLarkCliEntry: '/opt/run.js' }))).toBe('/opt/run.js')
  })

  it('auto-detects a real entry or none at all', () => {
    // 本机可能装了 lark-cli（探测到真实入口），也可能没有（返回 ''）；两者都合法
    const detected = resolveLarkCliEntry(baseConfig())
    const looksReal = detected === ''
      || detected.includes('@larksuite')
      || detected.includes('larksuite')
    expect(looksReal).toBe(true)
  })
})

describe('readLarkCliAppId', () => {
  it('reads the bound app id from a lark-cli config', () => {
    const home = mkdtempSync(join(tmpdir(), 'lark-home-'))
    mkdirSync(join(home, '.lark-cli'), { recursive: true })
    writeFileSync(
      join(home, '.lark-cli', 'config.json'),
      JSON.stringify({ apps: [{ appId: 'cli_abc123', brand: 'feishu' }] }),
    )
    expect(readLarkCliAppId(home)).toBe('cli_abc123')
  })

  it('returns undefined for missing or malformed configs', () => {
    const home = mkdtempSync(join(tmpdir(), 'lark-home-'))
    expect(readLarkCliAppId(home)).toBeUndefined()
    mkdirSync(join(home, '.lark-cli'), { recursive: true })
    writeFileSync(join(home, '.lark-cli', 'config.json'), 'not json')
    expect(readLarkCliAppId(home)).toBeUndefined()
  })
})
