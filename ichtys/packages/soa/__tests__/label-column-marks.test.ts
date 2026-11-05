/**
 * G22 §3 C1 — la columna de etiquetas se decide por marcas, no solo por texto.
 *
 * R-35 p31 (camino con prefijo): etiqueta de 6 letras, 10 enteros sueltos,
 * 4 fichas con prefijo y una más. El corte de 3ef8bf3 busca la primera ficha
 * que sea id de visita o tiempo y tira todo lo anterior: se van la etiqueta
 * (bien) y los 10 enteros (mal). Quedan 5 columnas y G2 puede ponerse verde
 * porque la columna que no cubría era la etiqueta. G2 es monótono: perder
 * columnas no lo empeora.
 */
import { describe, expect, it } from 'vitest'
import { locateSchedule, readGrid } from '../index'
import type { PageGeom, RawTable } from '../types'
import { build, centered, COL_W, COL_X0, LABEL_X0, text } from './synthetic-pages'

const tableOf = (pages: PageGeom[]): RawTable => readGrid(pages, locateSchedule(pages)).tables[0]!
const check = (table: RawTable, id: string) => table.checks.find((c) => c.id === id)!

/** 10 enteros + 4 fichas con prefijo + 1 que no es id de visita. */
const MIXED = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'ET', 'FA', 'EOS', 'VDT', 'XX'] as const

function mixedPage(): { pages: PageGeom[]; marks: number } {
  const built = build({
    header: { label: 'Visita', values: [...MIXED] },
    rowsPerPage: [4],
    commentsHeader: false,
  })
  // Fila de ventana bajo el encabezado (fuera de la ventana ±8 de las fichas)
  // que cubre las 15 columnas y no la etiqueta. Con el corte viejo, G2 sigue
  // en verde sobre las 5 que quedan.
  const pages = built.pages.map((p) => {
    const items = [...p.items, text(p.page, 'Ventana', LABEL_X0 + 2, 500, 6)]
    for (let c = 0; c < MIXED.length; c++) {
      items.push(centered(p.page, '±3', COL_X0 + c * COL_W + COL_W / 2, 500, 6))
    }
    return { ...p, items }
  })
  return { pages, marks: built.marks }
}

describe('G22 §3 C1 — etiqueta a la izquierda, enteros sueltos son columnas', () => {
  const { pages, marks } = mixedPage()

  it('etiqueta + 10 enteros + 4 fichas con prefijo + 1 más dan 15 columnas', () => {
    const table = tableOf(pages)
    expect(table.columns.map((c) => c.headerText)).toEqual([...MIXED])
    expect(table.columns.some((c) => c.headerText.includes('Visita'))).toBe(false)
  })

  it('la etiqueta cortada no tenía marcas: ninguna marca cae en banda sin ficha', () => {
    const table = tableOf(pages)
    expect(table.cells.filter((c) => c.kind === 'mark')).toHaveLength(marks)
    expect(check(table, 'G3').pass).toBe(true)
  })

  it('marcas asignadas + banda_sin_ficha se conserva, y G2 en verde no tapa una baja', () => {
    const table = tableOf(pages)
    const g2 = check(table, 'G2')
    const g3 = check(table, 'G3')
    const assigned = table.cells.filter((c) => c.kind === 'mark').length
    // Sin fila de ventana, G2 pasa en vacío y la señal no se mide.
    expect(g2.detail).not.toBe('sin fila de ventana')
    let bandaSinFicha = 0
    if (!g3.pass) {
      const detail = new RegExp(`p1 (\\d+)/(\\d+)(?: \\[([^\\]]*)\\])?`).exec(g3.detail)
      expect(detail, g3.detail).not.toBeNull()
      for (const part of (detail![3] ?? '').split(' ').filter(Boolean)) {
        const [name, count] = part.split(':')
        if (name === 'banda_sin_ficha') bandaSinFicha = Number(count)
      }
      // Las marcas que el corte manda a una banda sin ficha no desaparecen.
      expect(Number(detail![1]) + bandaSinFicha).toBe(Number(detail![2]))
    }
    expect(assigned + bandaSinFicha).toBe(marks)
    // Señal de G22: G2 verde en el mismo cambio en que bajan las marcas.
    expect(g2.pass && assigned < marks).toBe(false)
  })
})

describe('G22 §3 C1 — la primera visita puede ser un entero solo', () => {
  it('conserva el entero y las marcas que caen debajo', () => {
    const values = ['1', 'V2', 'V3', 'V4', 'V5', 'V6']
    const { pages, marks } = build({
      header: { label: 'Visitas', values },
      rowsPerPage: [3],
      commentsHeader: false,
    })
    const table = tableOf(pages)
    expect(table.columns.map((c) => c.headerText)).toEqual(values)
    expect(table.columns.some((c) => c.headerText.includes('Visitas'))).toBe(false)
    expect(table.cells.some((c) => c.kind === 'mark' && c.colIndex === 0)).toBe(true)
    expect(table.cells.filter((c) => c.kind === 'mark')).toHaveLength(marks)
  })
})
