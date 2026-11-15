import { describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/pg-proxy'
import { lastRetentionRun, retentionRunItem, RETENTION_RUN_MAX_AGE_HOURS } from '../retention-watch'

/**
 * El vigía de la tarea diaria de borrado de grabaciones. Si la tarea deja de correr (el secreto
 * falta o no coincide), nada se borra y nadie se entera: callar acá es afirmar que se borra.
 */
const NOW = new Date('2026-12-15T12:00:00.000Z')
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 60 * 60 * 1000)

describe('retentionRunItem — cuándo avisa Inicio', () => {
  it('corrió hace poco: no avisa', () => {
    expect(retentionRunItem(hoursAgo(6), NOW)).toBeNull()
    expect(retentionRunItem(hoursAgo(25), NOW)).toBeNull()
  })

  it('justo en el límite todavía no avisa; pasado el límite, sí', () => {
    expect(retentionRunItem(hoursAgo(RETENTION_RUN_MAX_AGE_HOURS), NOW)).toBeNull()
    expect(retentionRunItem(new Date(hoursAgo(RETENTION_RUN_MAX_AGE_HOURS).getTime() - 1000), NOW)).not.toBeNull()
  })

  it('el límite es un día y medio: una corrida salteada se avisa al día siguiente', () => {
    expect(RETENTION_RUN_MAX_AGE_HOURS).toBe(36)
  })

  it('no corre desde hace dos días: avisa con prioridad alta y dice cuándo fue la última', () => {
    const item = retentionRunItem(new Date('2026-12-13T06:17:00.000Z'), NOW)
    expect(item).toMatchObject({ id: 'system:retention-run', kind: 'system', severity: 'high', since: '2026-12-13T06:17:00.000Z' })
    expect(item!.title).toBe('El borrado diario de grabaciones no está corriendo')
    expect(item!.detail).toContain('Última corrida registrada: 13/12/2026 06:17 UTC')
  })

  it('sin ningún registro también avisa, y no inventa una fecha', () => {
    const item = retentionRunItem(null, NOW)
    expect(item).not.toBeNull()
    expect(item!.detail).toContain('No hay registro de ninguna corrida')
    expect(item!.since).toBeNull()
  })

  it('no afirma que haya grabaciones sin borrar: dice que puede haberlas', () => {
    for (const item of [retentionRunItem(null, NOW), retentionRunItem(hoursAgo(80), NOW)]) {
      expect(item!.detail).toContain('Puede haber grabaciones vencidas sin borrar')
    }
  })

  it('un registro con fecha futura (reloj corrido) no dispara el aviso', () => {
    expect(retentionRunItem(new Date(NOW.getTime() + 60_000), NOW)).toBeNull()
  })
})

describe('lastRetentionRun — qué registro mira', () => {
  function capture(rows: unknown[][]) {
    const sent: Array<{ sql: string; params: unknown[] }> = []
    const reader = drizzle(async (sql, params) => {
      sent.push({ sql, params })
      return { rows }
    })
    return { reader, sent }
  }

  it('busca el registro de corrida más reciente, que no es de ninguna organización', async () => {
    const { reader, sent } = capture([])
    await lastRetentionRun(reader)
    expect(sent).toHaveLength(1)
    const { sql, params } = sent[0]!
    expect(sql).toContain('from "audit_logs"')
    expect(sql).toContain('"audit_logs"."organization_id" is null')
    expect(sql).toMatch(/"audit_logs"\."action" = \$\d+/)
    expect(sql).toMatch(/order by "audit_logs"\."created_at" desc/)
    expect(params).toContain('retention.run')
    expect(params).toContain(1)
  })

  it('sin registros devuelve null', async () => {
    const { reader } = capture([])
    expect(await lastRetentionRun(reader)).toBeNull()
  })

  it('con registro devuelve su fecha', async () => {
    const { reader } = capture([['2026-12-14 06:17:03.000+00']])
    expect((await lastRetentionRun(reader))?.toISOString()).toBe('2026-12-14T06:17:03.000Z')
  })
})
