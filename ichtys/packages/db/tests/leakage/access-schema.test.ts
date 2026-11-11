import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { memberFunctions, organizations, studies, studyMemberships } from '../../schema'

/**
 * Leakage suite — invariantes del acceso por estudio
 * (docs/decisions/study-membership.md).
 *
 * Importa SOLO el schema. Las migraciones se escriben a mano, así que además
 * se comprueba que el SQL de la 0017 declare lo mismo que el schema: si uno
 * cambia sin el otro, la base y el código dejan de coincidir en silencio.
 */

const migrationSql = readFileSync(
  fileURLToPath(new URL('../../migrations/0017_access_functions_memberships.sql', import.meta.url)),
  'utf8',
)

function indexNamed(table: Parameters<typeof getTableConfig>[0], name: string) {
  return getTableConfig(table).indexes.find((candidate) => candidate.config.name === name)
}

describe('leakage — una membresía no puede cruzar organizaciones', () => {
  const membershipConfig = getTableConfig(studyMemberships)
  const compositeFk = membershipConfig.foreignKeys.find(
    (fk) => fk.getName() === 'study_memberships_study_org_fk',
  )

  it('study_memberships referencia (study_id, organization_id) de studies, no solo el estudio', () => {
    expect(compositeFk, 'falta la clave foránea compuesta').toBeDefined()
    const reference = compositeFk?.reference()
    expect(reference?.columns.map((column) => column.name)).toEqual(['study_id', 'organization_id'])
    expect(reference?.foreignColumns.map((column) => column.name)).toEqual(['id', 'organization_id'])
    expect(getTableConfig(reference?.foreignTable ?? organizations).name).toBe('studies')
  })

  it('study_id no tiene además una clave foránea simple que permita saltear la organización', () => {
    const simpleStudyFks = membershipConfig.foreignKeys.filter((fk) => {
      const columns = fk.reference().columns.map((column) => column.name)
      return columns.length === 1 && columns[0] === 'study_id'
    })
    expect(simpleStudyFks).toHaveLength(0)
  })

  it('studies tiene el índice único (id, organization_id) que la clave compuesta necesita', () => {
    const uniqueIdx = indexNamed(studies, 'studies_id_org_uniq')
    expect(uniqueIdx?.config.unique).toBe(true)
    expect(uniqueIdx?.config.columns.map((column) => ('name' in column ? column.name : ''))).toEqual([
      'id',
      'organization_id',
    ])
  })

  it('borrar un estudio suelto no se lleva la historia de accesos (sin cascada)', () => {
    expect(compositeFk?.onDelete ?? 'no action').toBe('no action')
    expect(migrationSql).toMatch(
      /"study_memberships_study_org_fk" FOREIGN KEY \("study_id","organization_id"\) REFERENCES "studies"\("id","organization_id"\) ON DELETE no action/,
    )
  })
})

describe('leakage — la baja conserva la historia', () => {
  it('las dos tablas tienen revoked_at y la unicidad vale solo para filas vigentes', () => {
    for (const [table, indexName] of [
      [memberFunctions, 'member_functions_active_uniq'],
      [studyMemberships, 'study_memberships_active_uniq'],
    ] as const) {
      const config = getTableConfig(table)
      expect(config.columns.find((column) => column.name === 'revoked_at')).toBeDefined()
      const uniqueIdx = indexNamed(table, indexName)
      expect(uniqueIdx?.config.unique, `${indexName} debe ser único`).toBe(true)
      expect(uniqueIdx?.config.where, `${indexName} debe ser parcial`).toBeDefined()
      expect(migrationSql).toContain(`"${indexName}"`)
      expect(migrationSql).toMatch(new RegExp(`"${indexName}"[^;]+WHERE "revoked_at" is null`))
    }
  })
})

describe('leakage — modo de acceso de la organización', () => {
  it('existe como columna propia, NOT NULL, y arranca en open', () => {
    const column = getTableConfig(organizations).columns.find((candidate) => candidate.name === 'access_mode')
    expect(column?.notNull).toBe(true)
    expect(column?.default).toBe('open')
  })

  it('la migración deja a las organizaciones existentes en open y rechaza valores desconocidos', () => {
    expect(migrationSql).toMatch(/ADD COLUMN IF NOT EXISTS "access_mode" text DEFAULT 'open' NOT NULL/)
    expect(migrationSql).toMatch(/CHECK \("access_mode" IN \('open', 'enforced'\)\)/)
  })

  it('la migración es aditiva: no borra ni modifica datos', () => {
    // «ON DELETE …» es la regla de una clave foránea, no una sentencia.
    const withoutFkRules = migrationSql.replace(/ON DELETE (cascade|no action)/gi, '')
    expect(withoutFkRules).not.toMatch(/\b(DROP|DELETE|TRUNCATE|UPDATE)\b/i)
  })
})
