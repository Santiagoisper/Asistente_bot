process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://test:test@localhost:5432/test?sslmode=disable'

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Patrón del paquete: mock de '../client' con builder encadenable (ver usage.test.ts).

const fake = vi.hoisted(() => ({
  rows: [] as unknown[],
}))

vi.mock('../client', () => {
  function makeBuilder(): Record<string, unknown> {
    const builder: Record<string, unknown> = {}
    for (const method of ['from', 'where', 'limit']) {
      builder[method] = () => builder
    }
    builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(fake.rows.shift()).then(resolve, reject)
    return builder
  }
  return {
    db: {
      select: (..._args: unknown[]) => makeBuilder(),
    },
  }
})

import { getOrgRagConfig } from '../org-config'

beforeEach(() => {
  fake.rows.length = 0
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('getOrgRagConfig — GLM salió del producto (E2E 2026-10-22)', () => {
  it("org con 'glm' guardado se lee como 'anthropic' → el chat usa Anthropic", async () => {
    fake.rows.push([{ ragConfig: { llmProvider: 'glm' } }])
    const config = await getOrgRagConfig('org-mig')
    expect(config.llmProvider).toBe('anthropic')
  })

  it("warn de migración una sola vez por org", async () => {
    const warn = vi.mocked(console.warn)
    fake.rows.push([{ ragConfig: { llmProvider: 'glm' } }])
    fake.rows.push([{ ragConfig: { llmProvider: 'glm' } }])
    await getOrgRagConfig('org-warn-x')
    await getOrgRagConfig('org-warn-x')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toContain('glm')
  })

  it('preferencias vigentes pasan intactas', async () => {
    fake.rows.push([{ ragConfig: { llmProvider: 'openai' } }])
    expect((await getOrgRagConfig('org-1')).llmProvider).toBe('openai')
    fake.rows.push([{ ragConfig: { llmProvider: 'auto' } }])
    expect((await getOrgRagConfig('org-1')).llmProvider).toBe('auto')
    fake.rows.push([{ ragConfig: null }])
    expect((await getOrgRagConfig('org-1')).llmProvider).toBe('auto')
  })
})
