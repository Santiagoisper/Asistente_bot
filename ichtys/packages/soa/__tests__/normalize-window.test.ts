/**
 * T2 (orden B-P3 §4) — parser de ventanas determinista: TODAS las formas
 * impresas reales (simétricas, asimétricas, «Hasta 42 d» partida, «n/c»,
 * «Margen de visita» como etiqueta) parsean exactas SIN modelo. Catálogo
 * medido en generate.py: ±2/±3/±7/±14 d · Hasta 42 d · up to 7 d · n/c ·
 * n/a · «±» pelado (F2) · −4/+2 semanas (nota de ventana propia) · −2/+3.
 */
import { describe, expect, it } from 'vitest'
import { parseWindow } from '../normalize/window'

describe('T2 — parser de ventanas sin modelo (catálogo completo)', () => {
  it('simétricas «±N u»', () => {
    expect(parseWindow('±2 d')).toEqual({ before: 2, after: 2, unit: 'day' })
    expect(parseWindow('±3 d')).toEqual({ before: 3, after: 3, unit: 'day' })
    expect(parseWindow('±7 d')).toEqual({ before: 7, after: 7, unit: 'day' })
    expect(parseWindow('±14 d')).toEqual({ before: 14, after: 14, unit: 'day' })
    expect(parseWindow('± 7 días')).toEqual({ before: 7, after: 7, unit: 'day' })
    expect(parseWindow('±2 sem')).toEqual({ before: 2, after: 2, unit: 'week' })
  })

  it('asimétricas «−A/+B» (magnitudes, ADR-7)', () => {
    expect(parseWindow('−2/+3')).toEqual({ before: 2, after: 3, unit: 'day' })
    expect(parseWindow('−4/+2 semanas')).toEqual({ before: 4, after: 2, unit: 'week' })
    expect(parseWindow('−4/+2 weeks')).toEqual({ before: 4, after: 2, unit: 'week' })
    expect(parseWindow('±0/+7 d')).toEqual({ before: 0, after: 7, unit: 'day' })
  })

  it('solo-after «Hasta N u» / «up to N u»: before null', () => {
    // F1: la partida en 4 ítems llega recompuesta («Hast a 42 d» → espacios).
    expect(parseWindow('Hasta 42 d')).toEqual({ before: null, after: 42, unit: 'day' })
    expect(parseWindow('Hast a 42 d')).toEqual({ before: null, after: 42, unit: 'day' })
    expect(parseWindow('up to 7 d')).toEqual({ before: null, after: 7, unit: 'day' })
  })

  it('sin ventana: «n/c», «n/a», vacío, «±» pelado y etiquetas → null', () => {
    for (const text of ['n/c', 'n/a', 'nc', '', '±', '-', 'Margen de visita', 'Ventana']) {
      expect(parseWindow(text), text).toBeNull()
    }
  })

  it('entero pelado o sin unidad → día por defecto; basura → null', () => {
    expect(parseWindow('hasta 42')).toEqual({ before: null, after: 42, unit: 'day' })
    for (const text of ['±7 meses', '±7 min', 'x/y']) {
      expect(parseWindow(text), text).toBeNull()
    }
  })

  it('exacta «0 d» (F2 T1): el día justo, sin tolerancia; entero pelado no', () => {
    expect(parseWindow('0 d')).toEqual({ before: 0, after: 0, unit: 'day' })
    // Sin unidad explícita no se inventa (criterio G23-K1): queda para el modelo.
    expect(parseWindow('42')).toBeNull()
  })

  it('G23-K2: dos signos iguales no son ventana before/after → null', () => {
    // «+3/+7»: todo después del día; «−7/−1»: todo antes. Ventana entera de
    // un lado: duda para el ensamblado, no un before/after inventado.
    expect(parseWindow('+3/+7 d')).toBeNull()
    expect(parseWindow('−7/−1')).toBeNull()
    expect(parseWindow('±3/+7')).toBeNull()
    // Las válidas siguen igual: −antes/+después, ±0/+después, ambas sin signo.
    expect(parseWindow('−2/+3')).toEqual({ before: 2, after: 3, unit: 'day' })
    expect(parseWindow('±0/+7 d')).toEqual({ before: 0, after: 7, unit: 'day' })
    expect(parseWindow('2/3')).toEqual({ before: 2, after: 3, unit: 'day' })
  })

  it('G23-K3: tope de abuso compartido con el contrato (±180 pasa, ±181 no)', () => {
    expect(parseWindow('±180 d')).toEqual({ before: 180, after: 180, unit: 'day' })
    expect(parseWindow('±181 d')).toBeNull()
    expect(parseWindow('hasta 999 d')).toBeNull()
  })

  it('G23 menor: «+/- 3 days» es la simétrica ±3 d', () => {
    expect(parseWindow('+/- 3 days')).toEqual({ before: 3, after: 3, unit: 'day' })
    expect(parseWindow('+/-2 d')).toEqual({ before: 2, after: 2, unit: 'day' })
  })
})
