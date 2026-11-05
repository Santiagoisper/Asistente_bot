/**
 * G18 §3.2/§3.3 (camino numérico): la tira de eje temporal etiquetada
 * («Semanas» 1, 8, 15…) bajo la tira de visitas del MISMO bloque proyecta
 * sus enteros como `timing` por x sobre las columnas de visita. Las
 * regiones ya garantizaron que están en el mismo bloque (sin marcas entre
 * ambas, discriminador §4); visitOnly dentro de la región oculta la tira
 * de tiempo como fuente de COLUMNAS — pero no como fuente de timing.
 *
 * F6 (R-dif): fila etiquetada de enteros con etiqueta elevada + fila
 * «semanas desde…» debajo, 19 columnas de visita, nunca 0.
 */
import { describe, expect, it } from 'vitest'
import { locateSchedule, readGrid } from '../index'
import { build, NUMERIC_VALUES } from './synthetic-pages'

describe('G18 §3.2 — proyección del timing en el camino numérico', () => {
  it('la tira «Semanas» del mismo bloque proyecta timing, no columnas', () => {
    const { pages } = build({
      header: { label: 'Número de visita', values: NUMERIC_VALUES },
      rowsPerPage: [3],
      timeRow: { label: 'Semanas', values: [1, 8, 15, 22, 29, 36] },
    })
    const table = readGrid(pages, locateSchedule(pages)).tables[0]!

    expect(table.columns).toHaveLength(18)
    expect(table.columns.every((c) => c.headerSource === 'numeric_visit')).toBe(true)
    // Las semanas caen por x sobre las primeras 6 columnas de visita.
    expect(table.columns.slice(0, 6).map((c) => c.timingText)).toEqual(['1', '8', '15', '22', '29', '36'])
    expect(table.columns.slice(6).every((c) => c.timingText === '')).toBe(true)
  })
})
