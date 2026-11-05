/**
 * pdf-text — texto con caja y bordes sobre los fixtures sintéticos (F1–F5).
 *
 * El "rojo" de este archivo es la inexistencia del paquete: `parser.ts` actual
 * (ingestion) descarta transform/width/height, así que ninguna de estas
 * aserciones de geometría podía escribirse antes (defecto D1 del ADR-10).
 * Los umbrales contra el gold vienen con locate/grid (T1–T7); acá se verifica
 * la CAPA: cajas sane, bordes presentes donde el gold dice que hay celdas, y
 * rotación reportada.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { loadPageGeometry } from '../pdf-text'
import type { BBox } from '../types'

const FIXTURES_DIR = fileURLToPath(new URL('../../../fixtures/soa/', import.meta.url))

function readPdf(fixture: string): Uint8Array {
  return new Uint8Array(readFileSync(`${FIXTURES_DIR}${fixture}.pdf`))
}

function readGold(fixture: string): {
  tables: Array<{ key: string; pages: number[] }>
  visits: Array<{ key: string; tableKey: string; page: number; bbox: BBox }>
  cells: Array<{ visitKey: string; procedureKey: string; page: number; bbox: BBox }>
} {
  return JSON.parse(readFileSync(`${FIXTURES_DIR}${fixture}.gold.json`, 'utf8'))
}

describe('loadPageGeometry — F1 (grilla densa)', () => {
  let pages: Awaited<ReturnType<typeof loadPageGeometry>>

  beforeAll(async () => {
    pages = await loadPageGeometry(readPdf('F1'))
  })

  it('devuelve las 60 páginas con items de caja sane', () => {
    expect(pages).toHaveLength(60)
    const p21 = pages[20]
    expect(p21).toBeDefined()
    expect(p21!.rotate).toBe(0)
    expect(p21!.items.length).toBeGreaterThan(200)
    for (const item of p21!.items) {
      expect(item.bbox[0]).toBeLessThan(item.bbox[2])
      expect(item.bbox[1]).toBeLessThanOrEqual(item.bbox[3])
      expect(item.fontSize).toBeGreaterThan(0)
      // dentro de la página (con toleranza de márgenes)
      expect(item.bbox[0]).toBeGreaterThanOrEqual(-1)
      expect(item.bbox[2]).toBeLessThanOrEqual(p21!.width + 1)
    }
  })

  it('los bordes de celda del gold existen como reglas verticales y horizontales', () => {
    const gold = readGold('F1')
    const p21 = pages[20]!

    // La primera visita de T1 (SEL): el gold la caja en [130, 542, 154.62, 562].
    // Sus bordes izquierdo y derecho deben existir como reglas V de esa página.
    const sel = gold.visits.find((v) => v.key === 'T1-C00')
    expect(sel).toBeDefined()
    const [x0, y0, x1, y1] = sel!.bbox
    const near = (a: number, b: number) => Math.abs(a - b) <= 1
    const leftRules = p21.rules.filter(
      (r) => near(r.x0, x0) && near(r.x1, x0) && r.y0 <= y0 + 1 && r.y1 >= y1 - 1,
    )
    const rightRules = p21.rules.filter(
      (r) => near(r.x0, x1) && near(r.x1, x1) && r.y0 <= y0 + 1 && r.y1 >= y1 - 1,
    )
    expect(leftRules.length).toBeGreaterThan(0)
    expect(rightRules.length).toBeGreaterThan(0)
    // Y el borde superior/inferior como reglas H a lo ancho de la visita.
    const topRules = p21.rules.filter(
      (r) => near(r.y0, y1) && near(r.y1, y1) && r.x0 <= x0 + 1 && r.x1 >= x1 - 1,
    )
    expect(topRules.length).toBeGreaterThan(0)
  })

  it('el texto de la marca de una celda gold cae dentro de la caja de esa celda', () => {
    const gold = readGold('F1')
    const p21 = pages[20]!
    const cell = gold.cells.find((c) => c.visitKey === 'T1-C00')
    expect(cell).toBeDefined()
    const [x0, y0, x1, y1] = cell!.bbox
    const inside = p21.items.filter((item) => {
      const cx = (item.bbox[0] + item.bbox[2]) / 2
      const cy = (item.bbox[1] + item.bbox[3]) / 2
      return cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1
    })
    // La marca 'x' de esa celda está en la capa de texto: tiene que haber
    // al menos un ítem con centro dentro de la caja gold.
    expect(inside.length).toBeGreaterThan(0)
  })

  it('es determinista y no desconecta el buffer de entrada (dos corridas iguales)', async () => {
    const buffer = readPdf('F1')
    const first = await loadPageGeometry(buffer)
    const second = await loadPageGeometry(buffer)
    expect(second).toHaveLength(first.length)
    const [a, b] = [first[20]!, second[20]!]
    expect(b.items).toHaveLength(a.items.length)
    expect(b.rules).toHaveLength(a.rules.length)
    expect(b.items[0]?.bbox).toEqual(a.items[0]?.bbox)
  })
})

describe('loadPageGeometry — F5 (página rotada /Rotate 90)', () => {
  it('reporta la rotación y deja el espacio de usuario sin rotar', async () => {
    const pages = await loadPageGeometry(readPdf('F5'))
    expect(pages).toHaveLength(40)
    // La primera página de T2 (gold: T2 pages [19, 20]) se dibuja apaisada en
    // el espacio de usuario y lleva /Rotate 90: el visor la gira, el gold no.
    const p19 = pages[18]!
    expect(p19.rotate).toBe(90)
    expect(p19.width).toBeGreaterThan(p19.height)
    expect(p19.items.length).toBeGreaterThan(100)
    for (const item of p19.items) {
      expect(item.bbox[0]).toBeLessThan(item.bbox[2])
      expect(item.fontSize).toBeGreaterThan(0)
    }
  })
})
