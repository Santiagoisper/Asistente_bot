/**
 * P2c C3 — la racha no se extiende a páginas sin encabezado propio ni
 * grilla densa.
 *
 * Medición privada del protocolo de 46 columnas: T0 absorbió una página
 * (p23) que no tiene encabezado propio ni grilla densa — entró solo por
 * contigüidad y subtítulo igual. Una página así no continúa la tabla
 * anterior: abre racha propia, y esa racha vive o muere por sus señales
 * (K1/P2b b) — si muere, queda visible en `rejected` con 'no_header',
 * nunca absorbida en silencio.
 *
 * La página DENSA sin encabezado legible sigue uniéndose (K1: tabla real
 * ilegible → failed visible, no pérdida).
 */
import { describe, expect, it } from 'vitest'
import { locateSchedule } from '../index'
import { build } from './synthetic-pages'

describe('P2c C3 — la racha no absorbe páginas sin encabezado propio ni densidad', () => {
  const base = build({
    header: { label: null, values: ['V1', 'V2', 'V3', 'V4', 'V5', 'V6'] },
    rowsPerPage: [3, 3],
    commentsHeader: false,
  })

  it('una página contigua con pocas marcas y sin fichas NO entra a la tabla', () => {
    // p3: misma estructura de grilla, mismo título y misma banda de períodos
    // (subtítulo igual), 4 columnas sin ficha de visita y 8 marcas — por
    // debajo de la densidad de racha.
    const extra = build({
      header: { label: null, values: ['aa', 'bb', 'cc', 'dd'] },
      rowsPerPage: [2],
      commentsHeader: false,
      firstPage: 3,
    })
    const location = locateSchedule([...base.pages, ...extra.pages])
    expect(location.tables).toHaveLength(1)
    expect(location.tables[0]!.pages).toEqual([1, 2])
    // La página expulsada es VISIBLE, con su razón — nunca absorbida.
    expect(location.rejected).toContainEqual({ page: 3, reason: 'no_header' })
  })

  it('la página DENSA sin encabezado legible SÍ se une (K1: tabla ilegible visible)', () => {
    const extra = build({
      header: { label: null, values: Array.from({ length: 18 }, (_, i) => `c${i + 1}`) },
      rowsPerPage: [3],
      commentsHeader: false,
      firstPage: 3,
    })
    const location = locateSchedule([...base.pages, ...extra.pages])
    expect(location.tables).toHaveLength(1)
    expect(location.tables[0]!.pages).toEqual([1, 2, 3])
  })
})
