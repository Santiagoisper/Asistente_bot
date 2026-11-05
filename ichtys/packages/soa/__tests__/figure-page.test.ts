/**
 * G18 §3.4 — página de figura: una línea de tiempo del diseño del estudio
 * trae muchas fichas APIÑADAS (mediana de separación < 10 pt) y sin marcas
 * de grilla. No es una página "con encabezado" y no puede iniciar ni
 * extender una racha.
 *
 * En R-46 la p23 (una figura con 21 fichas S… a ~6 pt) entró a la racha de
 * la tabla 1 por su headerCount alto y aportó 13 columnas falsas; C3 no la
 * expulsaba porque la página "sí tenía encabezado propio".
 */
import { describe, expect, it } from 'vitest'
import type { PageGeom, RuleLine, TextItem } from '../types'
import { locateSchedule } from '../index'
import { centered, text } from './synthetic-pages'

/** Página de FIGURA: marco, fichas apretadas (gap ~6 pt), sin marcas ni columnas. */
function figurePage(page: number): PageGeom {
  // Sin título de sección: mismo subtítulo ('') que la tabla siguiente, como
  // en R-46 donde la figura comparte el subtítulo de la grilla que sigue.
  const items: TextItem[] = []
  const rules: RuleLine[] = []
  let x = 60
  for (let k = 1; k <= 16; k++) {
    const str = `S${k}`
    items.push(text(page, str, x, 300, 5))
    x += str.length * 5 * 0.55 + 6
  }
  for (const y of [330, 280]) rules.push({ page, x0: 40, y0: y, x1: 400, y1: y })
  for (const vx of [40, 400]) rules.push({ page, x0: vx, y0: 280, x1: vx, y1: 330 })
  return { page, width: 842, height: 595, rotate: 0, items, rules }
}

/** Página de TABLA legítima: fichas V bien separadas por columnas + marcas. */
function tablePage(page: number): PageGeom {
  const items: TextItem[] = []
  const rules: RuleLine[] = []
  for (let c = 0; c < 12; c++) {
    items.push(centered(page, `V${c + 1}`, 170 + c * 34 + 17, 506))
  }
  const rowTops = [440, 422, 404]
  rowTops.forEach((top, r) => {
    items.push(text(page, `Procedimiento ${r + 1}`, 22, top, 6))
    for (const c of [r * 2, r * 2 + 4, r * 2 + 8].filter((v) => v < 12)) {
      items.push(centered(page, 'X', 170 + c * 34 + 17, top - 3, 7))
    }
  })
  for (const y of [515, 494, 442, 424, 406, 388]) {
    rules.push({ page, x0: 22, y0: y, x1: 170 + 12 * 34, y1: y })
  }
  for (let k = 0; k <= 12; k++) rules.push({ page, x0: 170 + k * 34, y0: 388, x1: 170 + k * 34, y1: 515 })
  rules.push({ page, x0: 22, y0: 388, x1: 22, y1: 515 })
  return { page, width: 842, height: 595, rotate: 0, items, rules }
}

describe('G18 §3.4 — la página de figura no es encabezado ni racha', () => {
  it('una figura antes de la tabla queda rejected y la tabla empieza en su página', () => {
    const location = locateSchedule([figurePage(1), tablePage(2)])
    expect(location.tables).toHaveLength(1)
    expect(location.tables[0]!.pages).toEqual([2])
    // Expulsada VISIBLE con su razón (K1), nunca absorbida.
    expect(location.rejected).toContainEqual({ page: 1, reason: 'low_density' })
  })
})
