/**
 * T9 + T10 + T12 — notas, chequeos G1–G5 y rendimiento (etapa b, orden B-P2 §5).
 *
 * T9 mide las LLAMADAS de nota (noteRefs de celda): el gold las guarda por
 * celda y acá se matchea geométricamente (la celda gold más cercana debe
 * llevar el ref en su `noteRefs`).
 *
 * T10 corre los cinco chequeos geométricos §4 y exige outcome 'complete' en
 * las tablas de F1–F5, y que el corte de documento (F3 sin sus últimas 10
 * páginas de grilla) deje la tabla afectada en 'partial' con
 * 'truncated_pages' — jamás 'complete'. El truncado se arma con
 * `pages.slice(0, 51)` ANTES de locateSchedule: no toca fixtures; la señal
 * es que la última página del documento es de grilla (los sanos terminan en
 * notas o relleno, nunca en grilla).
 *
 * T12 mide F3 completo (90 páginas): ≤ 10 s y heap ≤ 512 MB, medidos.
 *
 * Límite conocido (S8/L1, hoy SEÑALADO por G6/G7): las notas al pie de F2
 * T2 están dibujadas al costado de la grilla en fuente 5 — el lector extrae
 * notas de páginas dedicadas y de pies (fuente 8–10), no de columnas
 * laterales diminutas. Sus noteRefs de celda sí salen (T9 general los cubre
 * al 100 %); la pérdida ya no es silenciosa: G6 cuenta los refs sin texto y
 * G7 el texto pequeño no consumido (K1+R2), y la tabla baja a 'partial'.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadPageGeometry, locateSchedule, readGrid } from '../index'
import type { BBox, PageGeom, RawSchedule } from '../types'

const FIXTURES_DIR = fileURLToPath(new URL('../../../fixtures/soa/', import.meta.url))

interface GoldCell {
  visitKey: string
  page: number
  bbox: BBox
  mark: string
  noteRefs?: string[]
}

function readGold(fixture: string): { cells: GoldCell[] } {
  return JSON.parse(readFileSync(`${FIXTURES_DIR}${fixture}.gold.json`, 'utf8'))
}

function readPdf(fixture: string): Uint8Array {
  return new Uint8Array(readFileSync(`${FIXTURES_DIR}${fixture}.pdf`))
}

async function loadSchedule(fixture: string, cutPages?: number): Promise<RawSchedule> {
  const pages = await loadPageGeometry(readPdf(fixture))
  const input: PageGeom[] = cutPages === undefined ? pages : pages.slice(0, cutPages)
  return readGrid(input, locateSchedule(input))
}

describe('T9 — llamadas de nota (noteRefs) ≥ 90 % del gold', () => {
  for (const fixture of ['F1', 'F3', 'F5'] as const) {
    it(`${fixture}: cada celda gold con nota lleva su ref en la celda leída`, async () => {
      const gold = readGold(fixture)
      const schedule = await loadSchedule(fixture)
      const goldCells = gold.cells.filter((c) => (c.noteRefs ?? []).length > 0)
      // F5 es el fixture de refs alfabéticos (a–j): 10 celdas con nota.
      expect(goldCells.length).toBeGreaterThan(5)
      const mine = schedule.tables.flatMap((t) => t.cells)
      let withRefs = 0
      for (const cell of goldCells) {
        const [gx0, gy0, gx1, gy1] = cell.bbox
        let best = -1
        let bestDist = Infinity
        mine.forEach((c, i) => {
          if (c.page !== cell.page) return
          const cx = (c.bbox[0] + c.bbox[2]) / 2
          const cy = (c.bbox[1] + c.bbox[3]) / 2
          if (cx < gx0 - 1 || cx > gx1 + 1 || cy < gy0 - 1 || cy > gy1 + 1) return
          const dist = Math.abs(cx - (gx0 + gx1) / 2) + Math.abs(cy - (gy0 + gy1) / 2)
          if (dist < bestDist) {
            bestDist = dist
            best = i
          }
        })
        expect(best).toBeGreaterThanOrEqual(0)
        const want = cell.noteRefs!
        if (want.every((r) => mine[best]!.noteRefs.includes(r))) withRefs++
      }
      expect(withRefs / goldCells.length).toBeGreaterThanOrEqual(0.9)
    })
  }

  it('F1/F4/F5: notas de páginas dedicadas — mismos refs que el gold', async () => {
    for (const fixture of ['F1', 'F4', 'F5'] as const) {
      const gold = readGold(fixture)
      const goldNotes = (gold as unknown as {
        notes: Array<{ ref: string; tableKey: string }>
      }).notes
      const schedule = await loadSchedule(fixture)
      const mine = schedule.tables.flatMap((t) => t.notes.map((n) => `${t.key}:${n.ref}`)).sort()
      const want = goldNotes.map((n) => `${n.tableKey}:${n.ref}`).sort()
      expect(goldNotes.length).toBeGreaterThan(0)
      expect(mine).toEqual(want)
    }
  })
})

describe('T10 — chequeos G1–G7 y outcome', () => {
  for (const fixture of ['F1', 'F3', 'F4', 'F5'] as const) {
    it(`${fixture}: toda tabla pasa G1–G7 y queda 'complete'`, async () => {
      const schedule = await loadSchedule(fixture)
      expect(schedule.tables.length).toBeGreaterThan(0)
      for (const table of schedule.tables) {
        for (const check of table.checks) {
          expect(check.pass, `${fixture} ${table.key} ${check.id}: ${check.detail}`).toBe(true)
        }
        expect(table.outcome).toBe('complete')
        expect(table.reasons).toEqual([])
      }
    })
  }

  it('F2: T1/T3 sanas completas; T2 queda partial con G6 y G7 (pérdida silenciosa, K1+R2)', async () => {
    // Las notas al pie de F2 T2 están dibujadas al costado derecho de la
    // grilla en fuente 5 (columnas laterales de texto): el extractor de
    // notas no las alcanza y las celdas quedan con 16 refs únicos sin
    // texto. Antes esto salía 'complete' — pérdida silenciosa.
    const schedule = await loadSchedule('F2')
    const byKey = new Map(schedule.tables.map((t) => [t.key, t]))
    expect(byKey.get('T1')!.outcome).toBe('complete')
    expect(byKey.get('T3')!.outcome).toBe('complete')
    const t2 = byKey.get('T2')!
    expect(t2.outcome).toBe('partial')
    expect(t2.reasons).toContain('validation_failed:G6')
    expect(t2.reasons).toContain('validation_failed:G7')
    const g6 = t2.checks.find((c) => c.id === 'G6')!
    expect(g6.pass).toBe(false)
    expect(g6.detail).toBe('refs sin nota: 16')
  })

  it('F3 truncado: la tabla cortada queda partial con truncated_pages, nunca complete', async () => {
    // 90 páginas; las últimas 10 de GRILLA de T2 son p52–61, así que el
    // corte en 51 deja a T2 terminando en grilla (señal de truncado). T1
    // termina en p39 pero sus notas dedicadas viven al FINAL del documento
    // (p62+): el corte las elimina y G6 señala las 27 llamadas huérfanas —
    // la pérdida de notas por truncado ya no es invisible.
    const schedule = await loadSchedule('F3', 51)
    const t1 = schedule.tables[0]!
    const t2 = schedule.tables[1]!
    expect(t2.outcome).not.toBe('complete')
    expect(t2.outcome).toBe('partial')
    expect(t2.reasons).toContain('truncated_pages')
    expect(t1.outcome).toBe('partial')
    expect(t1.reasons).toContain('validation_failed:G6')
  })
})

describe('T12 — F3 completo: ≤ 10 s, heap ≤ 512 MB', () => {
  it('lectura completa medida', async () => {
    const started = performance.now()
    const schedule = await loadSchedule('F3')
    const elapsed = (performance.now() - started) / 1000
    const heap = process.memoryUsage().heapUsed / 1024 / 1024
    expect(schedule.tables.length).toBe(2)
    expect(elapsed).toBeLessThanOrEqual(10)
    expect(heap).toBeLessThanOrEqual(512)
  })
})
