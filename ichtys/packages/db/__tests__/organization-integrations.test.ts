import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { integrationCategory, organizationIntegrations, organizations } from '../schema'

const config = getTableConfig(organizationIntegrations)
const column = (name: string) => config.columns.find((c) => c.name === name)

describe('organization_integrations — integraciones por organización', () => {
  it('una organización tiene a lo sumo una fila por integración', () => {
    const unique = config.indexes.find((index) => index.config.unique)
    expect(unique?.config.name).toBe('organization_integrations_org_key_idx')
    expect(unique?.config.columns.map((c) => ('name' in c ? c.name : ''))).toEqual(['organization_id', 'integration_key'])
  })

  it('al borrar la organización se va su configuración', () => {
    const fk = config.foreignKeys[0]?.reference()
    expect(fk?.foreignTable).toBe(organizations)
    expect(config.foreignKeys[0]?.onDelete).toBe('cascade')
  })

  it('nace apagada para nadie: habilitada por defecto, y nunca simulada por defecto', () => {
    expect(column('enabled')?.notNull).toBe(true)
    expect(column('enabled')?.default).toBe(true)
    expect(column('simulated')?.notNull).toBe(true)
    expect(column('simulated')?.default).toBe(false)
  })

  it('las credenciales solo tienen lugar cifradas', () => {
    const names = config.columns.map((c) => c.name)
    expect(names).toContain('secrets_encrypted')
    for (const name of names) expect(name).not.toMatch(/^(secret|secrets|token|api_key|password|credentials)$/)
  })

  it('distingue módulos del OS de conectores a sistemas de destino', () => {
    expect([...integrationCategory]).toEqual(['module', 'connector'])
    expect(column('category')?.notNull).toBe(true)
  })

  it('la organización guarda sus ajustes del OS (zona horaria) sin obligar a tenerlos', () => {
    const settings = getTableConfig(organizations).columns.find((c) => c.name === 'os_settings')
    expect(settings).toBeDefined()
    expect(settings?.notNull).toBe(false)
  })

  it('la migración 0015 es aditiva y se puede correr dos veces', () => {
    const sql = readFileSync(join(__dirname, '..', 'migrations', '0015_organization_integrations.sql'), 'utf8')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "organization_integrations"')
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "os_settings" jsonb')
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "organization_integrations_org_key_idx"')
    expect(sql).toContain('EXCEPTION WHEN duplicate_object THEN null')
    expect(sql).not.toMatch(/\bDROP\b|DELETE FROM|\bTRUNCATE\b|ALTER COLUMN|RENAME/i)
    const journal = JSON.parse(readFileSync(join(__dirname, '..', 'migrations', 'meta', '_journal.json'), 'utf8')) as { entries: { idx: number; tag: string; when: number }[] }
    const migration = journal.entries.find((entry) => entry.idx === 15)
    const previous = journal.entries.find((entry) => entry.idx === 14)
    expect(migration).toMatchObject({ idx: 15, tag: '0015_organization_integrations' })
    expect(migration!.when).toBeGreaterThan(previous!.when)
  })
})
