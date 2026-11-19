import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * El índice de migraciones (`meta/_journal.json`) nombra cada archivo `.sql`,
 * en orden y sin huecos. La 0027 se integró sin su entrada (#227) y nadie lo
 * notó hasta el 17/11: esta guarda falla si vuelve a pasar con cualquier
 * migración.
 */
const dir = join(__dirname, '..', 'migrations')
const files = readdirSync(dir)
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .map((name) => name.replace(/\.sql$/, ''))
  .sort()
const journal = JSON.parse(readFileSync(join(dir, 'meta', '_journal.json'), 'utf8')) as {
  entries: Array<{ idx: number; tag: string; when: number }>
}

describe('índice de migraciones', () => {
  it('tiene una entrada por cada archivo .sql, con el mismo nombre y en el mismo orden', () => {
    expect(journal.entries.map((entry) => entry.tag)).toEqual(files)
  })

  it('numera las entradas 0, 1, 2… según el prefijo del archivo', () => {
    journal.entries.forEach((entry, position) => {
      expect(entry.idx).toBe(position)
      expect(entry.tag.slice(0, 4)).toBe(String(position).padStart(4, '0'))
    })
  })

  // Las 0000 y 0001 tienen fechas posteriores a la 0002 desde junio de 2026;
  // el historial no se reescribe. Desde la 0010, cada entrada es posterior a la anterior.
  it('desde la 0010, cada entrada es posterior a la anterior', () => {
    for (let i = 11; i < journal.entries.length; i++) {
      expect(journal.entries[i]!.when).toBeGreaterThan(journal.entries[i - 1]!.when)
    }
  })
})
