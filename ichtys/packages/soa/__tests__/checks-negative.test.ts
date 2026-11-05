/**
 * R1 + R7 — tests negativos de los chequeos geométricos (§4) y páginas
 * faltantes.
 *
 * Cada chequeo G1–G4 se fuerza a fallar con una mutación quirúrgica de la
 * geometría de F4 (el PageGeom se muta EN MEMORIA: los fixtures no se
 * tocan). El contrato: la tabla baja a 'partial' con reason
 * 'validation_failed:Gn' — jamás 'complete' con la pérdida en silencio.
 *
 * G5 (dos columnas de la misma página a <3 pt de centro) NO es forzable
 * por mutación de texto: `groupTexts` une fichas con gap ≤6 pt y la
 * subdivisión de bandas corta por puntos medios entre fichas, así que dos
 * bandas vecinas con sendas fichas quedan con centros a ≥ gap/2 ≥ 3 pt.
 * El invariante se aserta con dos fichas a 6.01 pt (el mínimo que el
 * agrupador NO une) y, además, la rama de falla del chequeo se prueba
 * DIRECTO sobre `columnCenterCollisions` (extraído de grid.ts justo para
 * eso) con columnas sintéticas: si el invariante se rompe algún día
 * (relajar el agrupador o los cortes), ese chequeo es el que baja la
 * tabla, y acá se ve fallar.
 *
 * G1 es POR PÁGINA (R5/G10, ADR-10 §d-1): una columna vacía SOLO en una
 * página, con contenido en todas las demás donde tiene ficha, es una
 * página desincronizada — la mutación de G10 (columna 0 de F1 vaciada en
 * p21) tiene que dar partial con p21 en el detail. Las columnas que el
 * documento llena parcialmente (las tiras de F3 rotan qué visitas tienen
 * procedimiento por página) no disparan.
 *
 * R7: si readGrid recibe un location que referencia una página que ya no
 * está entre las páginas leídas (un pipeline que recorta entre locate y
 * read), la tabla afectada sale 'failed' con 'grid_unreadable' — antes la
 * página se saltaba en silencio y la tabla daba 'complete'.
 *
 * Además (R1, segunda mitad): los índices que expone cada tabla son
 * reales — cada cell apunta a un columns[]/rows[] existente y cada marca
 * es única por (página, fila, columna) — verificado también sobre las
 * tablas mutadas, no solo sobre la sana.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { columnCenterCollisions, loadPageGeometry, locateSchedule, readGrid } from '../index'
import type { BBox, PageGeom, RawColumn, RawSchedule, RawTable } from '../types'

const FIXTURES_DIR = fileURLToPath(new URL('../../../fixtures/soa/', import.meta.url))

const MARKS = new Set(['x', 'X', '✓', '●', '•'])

const box = (x0: number, y0: number, x1: number, y1: number): BBox => [x0, y0, x1, y1]

let pages: PageGeom[]
let base: RawTable

beforeAll(async () => {
  pages = await loadPageGeometry(new Uint8Array(readFileSync(`${FIXTURES_DIR}F4.pdf`)))
  base = readGrid(pages, locateSchedule(pages)).tables[0]!
  expect(base.outcome).toBe('complete')
})

/** Exige el contrato negativo: partial + reason validation_failed:Gn. */
function expectPartialWith(table: RawTable, id: string): void {
  expect(table.outcome).toBe('partial')
  expect(table.reasons).toContain(`validation_failed:${id}`)
  expect(table.checks.find((c) => c.id === id)?.pass).toBe(false)
}

/** R1: los índices son reales — cells apuntan a columns/rows existentes. */
function expectIndexesConsistent(table: RawTable): void {
  for (const cell of table.cells) {
    expect(cell.colIndex).toBeGreaterThanOrEqual(0)
    expect(cell.colIndex).toBeLessThan(table.columns.length)
    expect(cell.rowIndex).toBeGreaterThanOrEqual(0)
    expect(cell.rowIndex).toBeLessThan(table.rows.length)
    expect(table.pages).toContain(cell.page)
    expect(table.columns[cell.colIndex]!.index).toBe(cell.colIndex)
    expect(table.rows[cell.rowIndex]!.index).toBe(cell.rowIndex)
    // Correspondencia geométrica (G10: una permutación sistemática de
    // índices pasa el chequeo de rango): la celda tiene que caer en la
    // banda de SU fila, y en la de su columna cuando la columna nació en
    // esa página (en páginas de continuación las tiras re-escalan).
    const row = table.rows[cell.rowIndex]!
    expect(row.page, `f${cell.rowIndex} en p${row.page} por celda en p${cell.page}`).toBe(cell.page)
    const cy = (cell.bbox[1] + cell.bbox[3]) / 2
    expect(cy).toBeGreaterThanOrEqual(row.y0 - 0.6)
    expect(cy).toBeLessThanOrEqual(row.y1 + 0.6)
    const col = table.columns[cell.colIndex]!
    if (col.page === cell.page) {
      if (cell.kind === 'mark') {
        // La marca cae EN una columna: su centro dentro de la banda.
        const cx = (cell.bbox[0] + cell.bbox[2]) / 2
        expect(cx, `c${cell.colIndex} x=[${col.x0},${col.x1}] marca cx=${cx}`).toBeGreaterThanOrEqual(col.x0 - 1)
        expect(cx).toBeLessThanOrEqual(col.x1 + 1)
      } else {
        // Combinada/texto: su caja CRUZA columnas por diseño — que
        // solape la banda de su columna de anclaje.
        expect(cell.bbox[0], `c${cell.colIndex} x=[${col.x0},${col.x1}] caja`).toBeLessThanOrEqual(col.x1 + 1)
        expect(cell.bbox[2]).toBeGreaterThanOrEqual(col.x0 - 1)
      }
    }
  }
  const seen = new Set<string>()
  for (const cell of table.cells) {
    if (cell.kind !== 'mark') continue
    const key = `${cell.page}:${cell.rowIndex}:${cell.colIndex}`
    expect(seen.has(key), `marca duplicada ${key}`).toBe(false)
    seen.add(key)
  }
}

function readMutated(mutated: PageGeom[]): RawTable {
  const table = readGrid(mutated, locateSchedule(mutated)).tables[0]!
  expectIndexesConsistent(table)
  return table
}

describe('R1 — cada chequeo G1–G5 detecta su defecto', () => {
  it('G1: sin marcas en una columna, la tabla es partial con validation_failed:G1', () => {
    const col = base.columns[2]!
    const mutated = pages.map((p) => ({
      ...p,
      items: p.items.filter((i) => {
        const cx = (i.bbox[0] + i.bbox[2]) / 2
        return !(MARKS.has(i.str.trim()) && cx >= col.x0 - 1 && cx <= col.x1 + 1)
      }),
    }))
    expectPartialWith(readMutated(mutated), 'G1')
  })

  it('G1 por página (R5/G10): columna 0 de F1 vaciada SOLO en p21 → partial con p21 en el detail', async () => {
    // La mutación del Reviewer: la columna tiene celdas en p22–p24, así
    // que el recuento POR TABLA la daba por cubierta y G1 pasaba. Con el
    // recuento por página, p21 queda como página desincronizada.
    const f1 = await loadPageGeometry(new Uint8Array(readFileSync(`${FIXTURES_DIR}F1.pdf`)))
    const base1 = readGrid(f1, locateSchedule(f1)).tables[0]!
    expect(base1.outcome).toBe('complete')
    const col = base1.columns[0]!
    expect(col.page).toBe(21)
    const mutated = f1.map((p) =>
      p.page !== 21
        ? p
        : {
            ...p,
            items: p.items.filter((i) => {
              if (!MARKS.has(i.str.trim())) return true
              const cx = (i.bbox[0] + i.bbox[2]) / 2
              return !(cx >= col.x0 - 1 && cx <= col.x1 + 1)
            }),
          },
    )
    const table = readGrid(mutated, locateSchedule(mutated)).tables[0]!
    expect(table.outcome).toBe('partial')
    expect(table.reasons).toContain('validation_failed:G1')
    expect(table.checks.find((c) => c.id === 'G1')?.detail).toContain('p21')
    expectIndexesConsistent(table)
  })

  it('G2: la fila de ventana con una celda sin cubrir es partial con validation_failed:G2', () => {
    const cell = base.windowRow!.cells[1] ?? base.windowRow!.cells[0]!
    const page = base.rows[cell.rowIndex]!.page
    const mutated = pages.map((p) =>
      p.page !== page
        ? p
        : {
            ...p,
            items: p.items.filter((i) => {
              const cx = (i.bbox[0] + i.bbox[2]) / 2
              const cy = (i.bbox[1] + i.bbox[3]) / 2
              return !(
                cx >= cell.bbox[0] - 1 &&
                cx <= cell.bbox[2] + 1 &&
                cy >= cell.bbox[1] - 3 &&
                cy <= cell.bbox[3] + 3
              )
            }),
          },
    )
    expectPartialWith(readMutated(mutated), 'G2')
  })

  it('G3: una marca fuera de toda banda de columna es partial con validation_failed:G3', () => {
    // La marca vive a la derecha de la última banda-x: es "presente sin
    // dueño" — el recuento de presentes supera al de asignadas.
    const page = base.pages[1] ?? base.pages[0]!
    const row = base.rows.find((r) => r.page === page)!
    const lastCol = base.columns[base.columns.length - 1]!
    const x = lastCol.x1 + 25
    const cy = (row.y0 + row.y1) / 2
    const mutated = pages.map((p) =>
      p.page !== page
        ? p
        : {
            ...p,
            items: [
              ...p.items,
              { page, str: 'X', bbox: box(x - 2, cy - 2, x + 2, cy + 2), fontSize: 7, rotated: false },
            ],
          },
    )
    expectPartialWith(readMutated(mutated), 'G3')
  })

  it('G4: una fila sin celdas pero con texto visible es partial con validation_failed:G4', () => {
    // Se vacía una fila con marcas (las marcas de sus celdas desaparecen)
    // y se le inyecta texto pequeño en la zona de columnas: la fila tiene
    // texto visible y ninguna celda — G4 la pesca.
    const markCells = base.cells.filter((c) => c.kind === 'mark')
    const target = markCells.find(
      (c) => markCells.filter((o) => o.rowIndex === c.rowIndex).length >= 3,
    )!
    const row = base.rows[target.rowIndex]!
    const rowCells = base.cells.filter((c) => c.rowIndex === target.rowIndex)
    const mutated = pages.map((p) => {
      if (p.page !== target.page) return p
      const items = p.items.filter((i) => {
        if (!MARKS.has(i.str.trim())) return true
        const cx = (i.bbox[0] + i.bbox[2]) / 2
        const cy = (i.bbox[1] + i.bbox[3]) / 2
        return !rowCells.some(
          (c) =>
            cx >= c.bbox[0] - 2 && cx <= c.bbox[2] + 2 && cy >= c.bbox[1] - 2 && cy <= c.bbox[3] + 2,
        )
      })
      const x = (base.columns[1]!.x0 + base.columns[1]!.x1) / 2
      const cy = (row.y0 + row.y1) / 2
      return {
        ...p,
        items: [
          ...items,
          { page: target.page, str: 'zz', bbox: box(x, cy - 3, x + 10, cy + 3), fontSize: 6, rotated: false },
        ],
      }
    })
    expectPartialWith(readMutated(mutated), 'G4')
  })

  it('G5: el invariante que defiende — fichas al mínimo gap agrupable quedan a ≥3 pt de centro y G5 sigue en pass', async () => {
    // Dos fichas falsas a 6.01 pt (justo por encima del TEXT_GROUP_GAP de
    // 6): el agrupador NO las une, cada una registra su columna — y aún
    // así sus centros quedan a ≥3 pt porque los cortes de banda son puntos
    // medios. G5 solo puede disparar si ese invariante se rompe.
    const lastCol = base.columns[base.columns.length - 1]!
    const hy = (lastCol.headerBBox[1] + lastCol.headerBBox[3]) / 2
    const a = lastCol.x0 + 7.7
    const mutated = pages.map((p) =>
      p.page !== lastCol.page
        ? p
        : {
            ...p,
            items: [
              ...p.items,
              { page: lastCol.page, str: 'V98', bbox: box(a, hy - 3, a + 1, hy + 3), fontSize: 6, rotated: false },
              { page: lastCol.page, str: 'V99', bbox: box(a + 7.01, hy - 3, a + 8.01, hy + 3), fontSize: 6, rotated: false },
            ],
          },
    )
    const table = readMutated(mutated)
    const inside = table.columns.filter(
      (c) => c.x0 >= lastCol.x0 - 1 && c.x1 <= lastCol.x1 + 1 && c.page === lastCol.page,
    )
    // La banda original quedó partida: al menos las dos nuevas y la ficha
    // impresa original viven dentro del rango de la última columna.
    expect(inside.length).toBeGreaterThanOrEqual(3)
    const centers = inside.map((c) => c.xCenter).sort((x, y) => x - y)
    for (let i = 1; i < centers.length; i++) {
      expect(centers[i]! - centers[i - 1]!).toBeGreaterThanOrEqual(3)
    }
    expect(table.checks.find((c) => c.id === 'G5')?.pass).toBe(true)
  })

  it('G5 (rama de falla): el chequeo extraído detecta columnas a <3 pt de centro en la misma página', () => {
    // Por mutación de ENTRADA G5 no es alcanzable (agrupador ≤6 pt +
    // cortes por puntos medios ⇒ centros ≥3 pt, invariante asertado en el
    // test de fichas a 6.01 pt). La rama de falla se prueba directo sobre
    // el chequeo extraído, con columnas sintéticas — si el invariante se
    // rompe algún día, este es el código que baja la tabla a partial.
    const col = (index: number, page: number, xCenter: number): RawColumn => ({
      index,
      page,
      xCenter,
      x0: xCenter - 17,
      x1: xCenter + 17,
      headerText: `V${index}`,
      headerBBox: box(xCenter - 4, 700, xCenter + 4, 714),
    })
    // Dos columnas de la misma página a 2 pt de centro: colisión.
    expect(columnCenterCollisions([col(0, 6, 200), col(1, 6, 202)])).toBe('p6')
    // A 3 pt o más, o en páginas distintas: nada.
    expect(columnCenterCollisions([col(0, 6, 200), col(1, 6, 203)])).toBeNull()
    expect(columnCenterCollisions([col(0, 6, 200), col(1, 7, 201)])).toBeNull()
    // Tres columnas donde dos se pisan en otra página: lista todas.
    expect(columnCenterCollisions([col(0, 6, 200), col(1, 6, 203), col(2, 8, 100), col(3, 8, 101)])).toBe('p8')
  })

  it('R1: la tabla sana de F4 tiene índices colIndex/rowIndex consistentes', () => {
    expectIndexesConsistent(base)
  })

  it('R1: una permutación sistemática de índices (colIndex+1, rowIndex+1) NO pasa la verificación', () => {
    // M6 del Reviewer: con solo rango+biyección+unicidad, permutar TODOS
    // los índices de forma consistente pasa el test. La correspondencia
    // geométrica es lo que la pesca: cada celda queda apuntando a una
    // fila/columna cuya página o banda no es la suya.
    const nCols = base.columns.length
    const nRows = base.rows.length
    const permuted: RawTable = {
      ...base,
      cells: base.cells.map((c) => ({
        ...c,
        colIndex: (c.colIndex + 1) % nCols,
        rowIndex: (c.rowIndex + 1) % nRows,
      })),
    }
    expect(() => expectIndexesConsistent(permuted)).toThrow()
  })
})

describe('R7 — página de grilla faltante, jamás salto silencioso', () => {
  it('un location que referencia una página ausente baja la tabla a failed con grid_unreadable', async () => {
    const full = await loadPageGeometry(new Uint8Array(readFileSync(`${FIXTURES_DIR}F3.pdf`)))
    const location = locateSchedule(full)
    const holed = full.filter((p) => p.page !== 30)
    const schedule: RawSchedule = readGrid(holed, location)

    const affected = schedule.tables.find((t) => t.pages.includes(30))
    expect(affected).toBeDefined()
    expect(affected!.outcome).toBe('failed')
    expect(affected!.reasons).toContain('grid_unreadable')
    // Solo la tabla que perdió la página falla; el resto sigue complete.
    for (const table of schedule.tables.filter((t) => t !== affected)) {
      expect(table.outcome).toBe('complete')
    }
  })
})
