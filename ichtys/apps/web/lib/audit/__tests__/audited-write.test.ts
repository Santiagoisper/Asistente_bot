import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Regla R3 del marco normativo: el dato y su registro de auditoría se confirman
 * juntos. Lo que se prueba acá es el contrato de `auditedWrite` con la base:
 * todo entra por la transacción, y cualquier falla sale como rechazo de la
 * transacción (que es lo que hace que la base revierta).
 *
 * La reversión en sí la hace Postgres; con la base simulada no se prueba.
 */
const state = vi.hoisted(() => ({
  log: [] as string[],
  auditRows: [] as Array<Record<string, unknown>>,
  failAudit: false,
  outcome: null as 'committed' | 'rolled_back' | null,
}))

vi.mock('@ichtys/db', () => {
  const auditLogs = { table: 'audit_logs' }
  const tx = {
    insert: (table: unknown) => ({
      values: async (values: Record<string, unknown>) => {
        if (table !== auditLogs) throw new Error('unexpected table')
        if (state.failAudit) throw new Error('audit insert failed')
        state.log.push('audit')
        state.auditRows.push(values)
      },
    }),
  }
  const db = {
    // Fuera de la transacción no se escribe nada.
    insert: () => {
      throw new Error('loose insert outside the transaction')
    },
    transaction: async <T,>(work: (handle: typeof tx) => Promise<T>): Promise<T> => {
      state.log.push('begin')
      try {
        const result = await work(tx)
        state.outcome = 'committed'
        return result
      } catch (error) {
        state.outcome = 'rolled_back'
        throw error
      }
    },
  }
  return { auditLogs, db, __tx: tx }
})

import * as dbModule from '@ichtys/db'
import { auditedWrite } from '../audited-write'

const tx = (dbModule as unknown as { __tx: unknown }).__tx
const entry = { action: 'evolution.create' as const, orgId: 'org-1', studyId: 'study-1', userId: 'user_1', resourceType: 'clinical_evolution', resourceId: 'evo-1', metadata: { contentLength: 12 } }

beforeEach(() => {
  state.log.length = 0
  state.auditRows.length = 0
  state.failAudit = false
  state.outcome = null
})

describe('auditedWrite — el dato y su auditoría en una sola transacción', () => {
  it('corre la escritura con la transacción y después registra la auditoría con su resultado', async () => {
    const received: unknown[] = []
    const result = await auditedWrite(
      async (handle) => {
        received.push(handle)
        state.log.push('write')
        return { id: 'evo-1' }
      },
      (created) => ({ ...entry, resourceId: created.id }),
    )

    expect(result).toEqual({ id: 'evo-1' })
    expect(received).toEqual([tx])
    expect(state.log).toEqual(['begin', 'write', 'audit'])
    expect(state.outcome).toBe('committed')
    expect(state.auditRows).toEqual([
      { action: 'evolution.create', organizationId: 'org-1', studyId: 'study-1', userId: 'user_1', resourceType: 'clinical_evolution', resourceId: 'evo-1', metadata: { contentLength: 12 } },
    ])
  })

  it('si el registro de auditoría falla, la transacción se rechaza y el error sube', async () => {
    state.failAudit = true
    await expect(auditedWrite(async () => ({ id: 'evo-1' }), () => entry)).rejects.toThrow('audit insert failed')
    expect(state.outcome).toBe('rolled_back')
    expect(state.auditRows).toHaveLength(0)
  })

  it('si la escritura falla, no se arma ni se escribe ningún registro', async () => {
    const audit = vi.fn(() => entry)
    await expect(
      auditedWrite(async () => {
        throw new Error('write failed')
      }, audit),
    ).rejects.toThrow('write failed')
    expect(audit).not.toHaveBeenCalled()
    expect(state.outcome).toBe('rolled_back')
    expect(state.auditRows).toHaveLength(0)
  })

  it('sin metadata guarda null, no undefined', async () => {
    await auditedWrite(async () => null, () => ({ action: 'agenda.create' as const, orgId: 'org-1' }))
    expect(state.auditRows[0]).toMatchObject({ action: 'agenda.create', metadata: null })
  })
})
