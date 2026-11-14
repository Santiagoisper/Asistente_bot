import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { clinicalEvolutions } from '../schema/clinical-evolutions'
import { dictationAudios } from '../schema/dictation-audios'
import { evolutionVoids } from '../schema/evolution-voids'
import { unassignedDictationAudios } from '../schema/unassigned-dictation-audios'

/**
 * Tres migraciones del dictado, todas aditivas (docs/decisions/consulta-dictada.md, D22 y D24;
 * docs/decisions/grabacion-en-sujeto-equivocado.md; docs/decisions/enlace-frase-audio.md).
 * Ninguna fila existente cambia y el código anterior sigue andando con ellas aplicadas.
 */
const read = (file: string) => readFileSync(join(__dirname, '..', 'migrations', file), 'utf8')
const statementsOf = (sql: string) =>
  sql
    .split('--> statement-breakpoint')
    .map((statement) => statement.replace(/^\s*--.*$/gm, '').trim())
    .filter(Boolean)
const columnsOf = (table: Parameters<typeof getTableConfig>[0]) => getTableConfig(table).columns
const column = (table: Parameters<typeof getTableConfig>[0], name: string) => columnsOf(table).find((c) => c.name === name)

const FILES = ['0020_evolution_dictation_takes.sql', '0021_evolution_voids_unassigned_audios.sql', '0022_dictation_audio_segments.sql']

describe('migraciones 0020 a 0022 — todas aditivas', () => {
  it.each(FILES)('%s no borra ni cambia nada que exista', (file) => {
    const sql = read(file)
    expect(sql).not.toMatch(/DROP\s|DELETE\s+FROM|TRUNCATE|UPDATE\s|ALTER\s+COLUMN|RENAME\s/i)
  })

  it.each(FILES)('%s se puede aplicar dos veces sin error', (file) => {
    for (const statement of statementsOf(read(file))) {
      expect(statement).toMatch(/IF NOT EXISTS|^DO \$\$ BEGIN[\s\S]*EXCEPTION WHEN duplicate_object THEN null; END \$\$;$/)
    }
  })

  it('están en el registro de migraciones, en orden, después de la 0019', () => {
    const journal = JSON.parse(read('meta/_journal.json')) as { entries: Array<{ idx: number; tag: string; when: number }> }
    const tail = journal.entries.slice(-4)
    expect(tail.map((entry) => [entry.idx, entry.tag])).toEqual([
      [19, '0019_dictation_audio_takes'],
      [20, '0020_evolution_dictation_takes'],
      [21, '0021_evolution_voids_unassigned_audios'],
      [22, '0022_dictation_audio_segments'],
    ])
    const whens = tail.map((entry) => entry.when)
    expect([...whens].sort((a, b) => a - b)).toEqual(whens)
  })
})

describe('0020 — cuántas tomas tuvo una evolución dictada (D22)', () => {
  it('una sola columna nueva, opcional: las evoluciones que ya existen quedan sin valor', () => {
    expect(statementsOf(read(FILES[0]!))).toEqual(['ALTER TABLE "clinical_evolutions" ADD COLUMN IF NOT EXISTS "dictation_takes" integer;'])
    expect(column(clinicalEvolutions, 'dictation_takes')).toMatchObject({ notNull: false, hasDefault: false })
  })
})

describe('0021 — anular una evolución y retirar su grabación (D24)', () => {
  const sql = read(FILES[1]!)

  it('la anulación es una fila aparte: la tabla de evoluciones no se toca', () => {
    expect(sql).not.toMatch(/ALTER TABLE "clinical_evolutions"/)
    expect(sql).not.toMatch(/ALTER TABLE "dictation_audios"/)
  })

  it('una evolución se anula una sola vez', () => {
    const uniques = getTableConfig(evolutionVoids).indexes.filter((index) => index.config.unique).map((index) => index.config.columns.map((c) => ('name' in c ? c.name : '?')))
    expect(uniques).toEqual([['evolution_id']])
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS "evolution_voids_evolution_uniq" ON "evolution_voids" USING btree \("evolution_id"\);/)
  })

  it('la anulación dice quién, cuándo y por qué; la nota va cifrada y es opcional', () => {
    for (const name of ['organization_id', 'study_id', 'subject_id', 'evolution_id', 'reason', 'declared_by', 'declared_at']) {
      expect(column(evolutionVoids, name), name).toMatchObject({ notNull: true })
    }
    expect(column(evolutionVoids, 'note_encrypted')).toMatchObject({ notNull: false })
  })

  it('el depósito de grabaciones no tiene columna de sujeto', () => {
    expect(columnsOf(unassignedDictationAudios).map((c) => c.name)).not.toContain('subject_id')
    expect(sql).not.toMatch(/unassigned_dictation_audios[\s\S]*"subject_id"/)
  })

  it('el vencimiento no tiene valor por defecto: se copia de la grabación original, no se vuelve a calcular', () => {
    expect(column(unassignedDictationAudios, 'expires_at')).toMatchObject({ notNull: true, hasDefault: false })
    expect(column(unassignedDictationAudios, 'created_at')).toMatchObject({ notNull: true, hasDefault: false })
  })

  it('cada grabación pasa al depósito una sola vez, y guarda de qué grabación y de qué evolución vino', () => {
    const uniques = getTableConfig(unassignedDictationAudios).indexes.filter((index) => index.config.unique).map((index) => index.config.columns.map((c) => ('name' in c ? c.name : '?')))
    expect(uniques).toEqual([['source_audio_id']])
    for (const name of ['source_audio_id', 'evolution_id', 'take', 'sha256', 'created_by', 'declared_by', 'declared_at']) {
      expect(column(unassignedDictationAudios, name), name).toMatchObject({ notNull: true })
    }
  })

  it('tiene lo mismo que una grabación común para vencer y borrarse: contenido opcional, fecha de borrado, índice por vencimiento', () => {
    expect(column(unassignedDictationAudios, 'content_encrypted')).toMatchObject({ notNull: false })
    expect(column(unassignedDictationAudios, 'purged_at')).toMatchObject({ notNull: false })
    const indexed = getTableConfig(unassignedDictationAudios).indexes.map((index) => index.config.columns.map((c) => ('name' in c ? c.name : '?')).join(','))
    expect(indexed).toContain('expires_at')
  })
})

describe('0022 — los tramos de lo dictado, junto a su grabación', () => {
  it('una columna nueva, opcional y cifrada: las grabaciones que ya existen quedan sin tramos', () => {
    expect(statementsOf(read(FILES[2]!))).toEqual(['ALTER TABLE "dictation_audios" ADD COLUMN IF NOT EXISTS "segments_encrypted" text;'])
    expect(column(dictationAudios, 'segments_encrypted')).toMatchObject({ notNull: false, hasDefault: false })
  })

  it('el depósito ya nace con la misma columna: los tramos viajan con la grabación', () => {
    expect(column(unassignedDictationAudios, 'segments_encrypted')).toMatchObject({ notNull: false })
  })
})
