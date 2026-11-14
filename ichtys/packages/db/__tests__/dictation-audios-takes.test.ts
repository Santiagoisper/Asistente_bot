import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { dictationAudios } from '../schema/dictation-audios'

/** Varias grabaciones por evolución (docs/decisions/consulta-dictada.md, D22). */
describe('dictation_audios — una fila por toma', () => {
  it('el esquema: única por (evolución, toma), ya no por evolución sola', () => {
    const uniques = getTableConfig(dictationAudios)
      .indexes.filter((index) => index.config.unique)
      .map((index) => ({ name: index.config.name, columns: index.config.columns.map((column) => ('name' in column ? column.name : '?')) }))
    expect(uniques).toEqual([{ name: 'dictation_audios_evolution_take_uniq', columns: ['evolution_id', 'take'] }])
  })

  it('la toma tiene valor por defecto 1: el código anterior, que no la manda, sigue guardando la primera', () => {
    const take = getTableConfig(dictationAudios).columns.find((column) => column.name === 'take')
    expect(take).toMatchObject({ notNull: true, hasDefault: true, default: 1 })
  })

  describe('migración 0019', () => {
    const sql = readFileSync(join(__dirname, '..', 'migrations', '0019_dictation_audio_takes.sql'), 'utf8')
    const statements = sql
      .split('--> statement-breakpoint')
      .map((statement) => statement.replace(/^\s*--.*$/gm, '').trim())
      .filter(Boolean)

    it('no borra tablas, columnas ni filas', () => {
      expect(sql).not.toMatch(/DROP\s+TABLE|DROP\s+COLUMN|DELETE\s+FROM|TRUNCATE/i)
    })

    it('agrega la columna con su valor por defecto, crea la unicidad nueva y recién después saca la vieja', () => {
      expect(statements).toHaveLength(3)
      expect(statements[0]).toMatch(/^ALTER TABLE "dictation_audios" ADD COLUMN IF NOT EXISTS "take" integer DEFAULT 1 NOT NULL;$/)
      expect(statements[1]).toMatch(/^CREATE UNIQUE INDEX IF NOT EXISTS "dictation_audios_evolution_take_uniq" ON "dictation_audios" USING btree \("evolution_id","take"\);$/)
      expect(statements[2]).toMatch(/^DROP INDEX IF EXISTS "dictation_audios_evolution_uniq";$/)
    })

    it('está en el registro de migraciones, después de la 0018', () => {
      const journal = JSON.parse(readFileSync(join(__dirname, '..', 'migrations', 'meta', '_journal.json'), 'utf8')) as { entries: Array<{ idx: number; tag: string }> }
      expect(journal.entries.slice(-2).map((entry) => [entry.idx, entry.tag])).toEqual([
        [18, '0018_dictation_audios'],
        [19, '0019_dictation_audio_takes'],
      ])
    })
  })
})
