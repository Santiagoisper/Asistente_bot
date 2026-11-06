/**
 * P2d (G26): la prosa previa a la grilla y las marcas de atributo salen en
 * el raw, aparte de las celdas. El texto no se imprime: el test solo afirma
 * que la frase está.
 *
 * «después de V7» está en la sinopsis de F2. F1 dibuja la sinopsis antes de
 * asignar las reglas, así que esa frase no está en su página 2.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadPageGeometry, locateSchedule, readGrid } from '../index'
import { RULE_CHAR_CAP, RULE_PAGE_CAP } from '../rule-paragraphs'

const FIXTURES_DIR = fileURLToPath(new URL('../../../fixtures/soa/', import.meta.url))

async function scheduleOf(fixture: string) {
  const pages = await loadPageGeometry(new Uint8Array(readFileSync(`${FIXTURES_DIR}${fixture}.pdf`)))
  return readGrid(pages, locateSchedule(pages))
}

describe('P2d — prosa previa y marcas de atributo', () => {
  it('F2 entrega «después de V7» en un párrafo de sinopsis anterior a la primera tabla', async () => {
    const schedule = await scheduleOf('F2')
    const firstTablePage = Math.min(...schedule.tables.flatMap((table) => table.pages))
    const hit = schedule.ruleParagraphs.find((paragraph) => paragraph.text.includes('después de V7'))
    expect(hit).toBeDefined()
    expect(hit!.page).toBeLessThan(firstTablePage)
    expect(schedule.location.rejected.find((item) => item.page === hit!.page)?.reason).toBe('synopsis_prose')
    const synopsisPages = new Set(
      schedule.ruleParagraphs
        .filter((paragraph) => paragraph.page < firstTablePage)
        .map((paragraph) => paragraph.page),
    )
    expect(synopsisPages.size).toBeLessThanOrEqual(RULE_PAGE_CAP)
    const chars = schedule.ruleParagraphs.reduce((acc, paragraph) => acc + paragraph.text.length, 0)
    expect(chars).toBeLessThanOrEqual(RULE_CHAR_CAP)
    expect(schedule.ruleParagraphs.map((paragraph) => paragraph.index)).toEqual(
      schedule.ruleParagraphs.map((_, index) => index),
    )
  })

  it('F1 entrega la sinopsis, y esa página no trae «después de V7»', async () => {
    const schedule = await scheduleOf('F1')
    const firstTablePage = Math.min(...schedule.tables.flatMap((table) => table.pages))
    const synopsis = schedule.ruleParagraphs.filter((paragraph) => paragraph.page < firstTablePage)
    expect(synopsis.length).toBeGreaterThan(0)
    expect(synopsis.some((paragraph) => /sinopsis/i.test(paragraph.text))).toBe(true)
    expect(schedule.ruleParagraphs.some((paragraph) => paragraph.text.includes('después de V7'))).toBe(false)
  })

  it('F2 pone Ayuno y Visita a la clínica en attributeMarks y en cero celdas', async () => {
    const schedule = await scheduleOf('F2')
    const labels = new Set<string>()
    for (const table of schedule.tables) {
      for (const mark of table.attributeMarks) {
        const row = table.rows[mark.rowIndex]
        expect(row?.isAttributeCandidate).toBe(true)
        if (row) labels.add(row.label)
      }
      for (const cell of table.cells) {
        const row = table.rows[cell.rowIndex]
        expect(row?.isAttributeCandidate ?? false).toBe(false)
      }
    }
    expect([...labels].some((label) => /ayuno/i.test(label))).toBe(true)
    expect([...labels].some((label) => /visita a la clínica/i.test(label))).toBe(true)
  })
})
