import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { conversations, messages } from '../schema/conversations'

/**
 * 0028: cierre del chat cifrado. Quita (regla 48): va después del código que dejó de
 * leer las columnas en claro (#232) y se aplica con los conteos en cero medidos en el
 * momento. Es la única migración del chat que borra columnas: si su SQL cambia, esta
 * prueba lo muestra.
 */
const read = (file: string) => readFileSync(join(__dirname, '..', 'migrations', file), 'utf8')
const sql = read('0028_drop_chat_plaintext.sql')
const statements = sql
  .split('--> statement-breakpoint')
  .map((statement) => statement.replace(/^\s*--.*$/gm, '').trim())
  .filter(Boolean)
const names = (table: Parameters<typeof getTableConfig>[0]) => getTableConfig(table).columns.map((c) => c.name)

describe('migración 0028 — el chat sin columnas en claro', () => {
  it('son exactamente estas cinco sentencias, en este orden: el CHECK, la obligatoria y las tres columnas', () => {
    expect(statements).toEqual([
      'ALTER TABLE "messages" DROP CONSTRAINT IF EXISTS "messages_content_present";',
      'ALTER TABLE "messages" ALTER COLUMN "content_encrypted" SET NOT NULL;',
      'ALTER TABLE "messages" DROP COLUMN IF EXISTS "content";',
      'ALTER TABLE "messages" DROP COLUMN IF EXISTS "annotations";',
      'ALTER TABLE "conversations" DROP COLUMN IF EXISTS "title";',
    ])
  })

  it('no borra filas ni tablas, ni toca otra tabla u otra columna', () => {
    const texto = statements.join('\n')
    expect(texto).not.toMatch(/DELETE\s+FROM|TRUNCATE|DROP\s+TABLE|UPDATE\s/i)
    expect(texto).not.toContain('DROP COLUMN IF EXISTS "content_encrypted"')
    expect(texto).not.toContain('DROP COLUMN IF EXISTS "title_encrypted"')
    const tablas = statements.map((s) => /ALTER TABLE "([a-z_]+)"/.exec(s)?.[1])
    expect(new Set(tablas)).toEqual(new Set(['messages', 'conversations']))
  })

  it('el CHECK que nombra la columna vieja se saca antes que la columna', () => {
    expect(statements.findIndex((s) => s.includes('messages_content_present'))).toBeLessThan(
      statements.findIndex((s) => s.includes('DROP COLUMN IF EXISTS "content"')),
    )
  })

  it('dice en el archivo qué conteos medir antes, y que no tiene vuelta atrás sin restaurar', () => {
    expect(sql).toContain('WHERE content IS NOT NULL')
    expect(sql).toContain('WHERE content_encrypted IS NULL')
    expect(sql).toContain('WHERE title IS NOT NULL')
    expect(sql).toContain('instantánea')
  })

  it('el schema ya coincide con la base después de la 0028', () => {
    expect(names(messages)).not.toContain('content')
    expect(names(messages)).not.toContain('annotations')
    expect(names(conversations)).not.toContain('title')
    expect(getTableConfig(messages).columns.find((c) => c.name === 'content_encrypted')?.notNull).toBe(true)
    expect(getTableConfig(conversations).columns.find((c) => c.name === 'title_encrypted')?.notNull).toBe(false)
  })

  it('está en el índice de migraciones, después de la 0027', () => {
    const journal = JSON.parse(read('meta/_journal.json')) as { entries: Array<{ idx: number; tag: string; when: number }> }
    const last = journal.entries.at(-1)
    const previous = journal.entries.at(-2)
    expect([previous?.idx, previous?.tag]).toEqual([27, '0027_file_fingerprints'])
    expect([last?.idx, last?.tag]).toEqual([28, '0028_drop_chat_plaintext'])
    expect(last!.when).toBeGreaterThan(previous!.when)
  })
})
