/**
 * T1 + T2 — locate (etapa a, orden B-P2 §5).
 *
 * El "rojo" es doble: el paquete no existía y el extractor actual
 * (`locateSectionByKeywords`) toma el primer acierto de un vocabulario de 6
 * expresiones sobre 200 caracteres por página — con estos fixtures acierta al
 * índice (p3) y a la lista de tablas (p4) antes que a la grilla. La
 * comparación es contra las cajas/páginas del gold con un ayudante local de
 * test (hasta que exista `scoreGrid`, C5).
 *
 * T1: páginas de grilla P = R = 100 %, 0 falsos aciertos, y las páginas
 *     trampa (índice / lista de tablas / sinopsis) quedan en `rejected`
 *     con su motivo.
 * T2: tablas detectadas y sus páginas: 100 %, incluida la continuación de F3
 *     (49 páginas de grilla, más de las 30 del defecto D2) y la unión de las
 *     tiras de columnas de F3 en una sola tabla. Las notas DEDICADAS del gold
 *     (páginas sin grilla) deben quedar como `notePages` de su tabla; las
 *     notas que viven en una página de grilla (F2 T2, p15) las captura la
 *     etapa de notas del commit 5, no locate.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { loadPageGeometry, locateSchedule } from '../index'
import type { PageGeom, ScheduleLocation } from '../types'

const FIXTURES_DIR = fileURLToPath(new URL('../../../fixtures/soa/', import.meta.url))

interface GoldTable {
  key: string
  pages: number[]
  notePages: number[]
}

interface Gold {
  document: { sopPages: number[]; falseHitPages: number[] }
  tables: GoldTable[]
}

function readGold(fixture: string): Gold {
  return JSON.parse(readFileSync(`${FIXTURES_DIR}${fixture}.gold.json`, 'utf8'))
}

function readPdf(fixture: string): Uint8Array {
  return new Uint8Array(readFileSync(`${FIXTURES_DIR}${fixture}.pdf`))
}

const FIXTURES = ['F1', 'F2', 'F3', 'F4', 'F5'] as const

/** Páginas aceptadas como grilla por locate (unión de las tablas). */
function gridPages(location: ScheduleLocation): Set<number> {
  return new Set(location.tables.flatMap((t) => t.pages))
}

describe('T1 — localización de páginas de grilla', () => {
  const locations = new Map<string, ScheduleLocation>()

  beforeAll(async () => {
    for (const fixture of FIXTURES) {
      const pages: PageGeom[] = await loadPageGeometry(readPdf(fixture))
      locations.set(fixture, locateSchedule(pages))
    }
  })

  for (const fixture of FIXTURES) {
    it(`${fixture}: P = R = 100 % contra sopPages del gold, 0 falsos aciertos`, () => {
      const gold = readGold(fixture)
      const got = gridPages(locations.get(fixture)!)
      const goldSet = new Set(gold.document.sopPages)
      const tp = [...got].filter((p) => goldSet.has(p)).length
      // Precisión: todo lo aceptado es del gold; recall: todo el gold aceptado.
      expect(got.size).toBe(tp)
      expect(tp).toBe(goldSet.size)
      // 0 falsos aciertos: ninguna página trampa aceptada.
      for (const page of gold.document.falseHitPages) {
        expect(got.has(page)).toBe(false)
      }
    })

    it(`${fixture}: índice, lista de tablas y sinopsis rechazadas con su motivo`, () => {
      const gold = readGold(fixture)
      const location = locations.get(fixture)!
      const rejected = new Map(location.rejected.map((r) => [r.page, r.reason]))
      // El gold marca las tres trampas en páginas 2 (sinopsis), 3 (índice) y 4 (lista).
      expect(rejected.get(2)).toBe('synopsis_prose')
      expect(rejected.get(3)).toBe('toc')
      expect(rejected.get(4)).toBe('list_of_tables')
      for (const page of gold.document.falseHitPages) {
        expect(rejected.has(page)).toBe(true)
      }
    })
  }

  it('F2: la grilla vertical de preinclusión (p11–p14, 2 columnas) se acepta igual', () => {
    const got = gridPages(locations.get('F2')!)
    for (const page of [11, 12, 13, 14]) expect(got.has(page)).toBe(true)
  })

  it('F5: la tabla rotada (/Rotate 90) se acepta por sus señales, no por el aspecto', () => {
    const got = gridPages(locations.get('F5')!)
    expect(got.has(19)).toBe(true)
    expect(got.has(20)).toBe(true)
  })

  it('candidates audita las páginas con score > 0 (las trampas están, con señales)', () => {
    const location = locations.get('F1')!
    const candidatePages = new Set(location.candidates.map((c) => c.page))
    expect(candidatePages.has(21)).toBe(true) // grilla
    expect(candidatePages.has(2)).toBe(true) // sinopsis: score > 0 por el título en prosa
    const synopsis = location.candidates.find((c) => c.page === 2)
    expect(synopsis?.signals.synopsis).toBe(1)
    expect(synopsis?.signals.rulesV).toBe(0)
  })
})

describe('T2 — tablas detectadas y sus páginas', () => {
  const locations = new Map<string, ScheduleLocation>()

  beforeAll(async () => {
    for (const fixture of FIXTURES) {
      const pages: PageGeom[] = await loadPageGeometry(readPdf(fixture))
      locations.set(fixture, locateSchedule(pages))
    }
  })

  for (const fixture of FIXTURES) {
    it(`${fixture}: mismas tablas que el gold y mismas páginas por tabla`, () => {
      const gold = readGold(fixture)
      const location = locations.get(fixture)!
      expect(location.tables).toHaveLength(gold.tables.length)
      location.tables.forEach((table, i) => {
        expect(table.pages).toEqual(gold.tables[i]!.pages)
      })
    })

    it(`${fixture}: notas dedicadas del gold como notePages de su tabla`, () => {
      const gold = readGold(fixture)
      const location = locations.get(fixture)!
      location.tables.forEach((table, i) => {
        // Las notas en página de grilla (F2 T2: p15) no son cosa de locate.
        const dedicated = gold.tables[i]!.notePages.filter(
          (p) => !gold.tables[i]!.pages.includes(p),
        )
        expect(table.notePages).toEqual(dedicated)
      })
    })
  }

  it('F3: la continuación de 49 páginas de grilla no se corta en 30 (defecto D2)', () => {
    const location = locations.get('F3')!
    const grid = [...gridPages(location)]
    expect(grid.length).toBe(49)
    expect(grid[0]).toBe(13)
    expect(grid[grid.length - 1]).toBe(61)
    // Y las tiras de columnas de la parte A (V1–V10 / V11–V16 / completa)
    // siguen siendo UNA tabla, no tres.
    const t1 = location.tables[0]!
    expect(t1.pages).toHaveLength(27)
    expect(t1.headerSignature).toContain('V1')
    expect(t1.headerSignature).toContain('V16')
  })

  it('F1: las tablas separadas por páginas de notas quedan separadas', () => {
    const location = locations.get('F1')!
    expect(location.tables.map((t) => t.key)).toEqual(['T1', 'T2', 'T3'])
    expect(location.tables[0]!.notePages).toEqual([25])
    expect(location.tables[1]!.notePages).toEqual([29])
    expect(location.tables[2]!.notePages).toEqual([32])
  })
})
