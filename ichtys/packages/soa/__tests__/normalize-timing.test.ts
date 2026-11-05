/**
 * T1 (orden B-P3 §4) — parser de tiempo determinista: el 100 % de las
 * visitas programadas de F1–F5 con día canónico correcto SIN llamar al
 * modelo. El texto de la fila de timing se deriva del propio gold con la
 * MISMA fórmula del generador (`f"{value}{unit[0]}"` → "12w", "-42d"),
 * así el test recorre las visitas reales de los cinco fixtures, no una
 * muestra. El kind 'recurrent' no es derivable del texto de UNA celda
 * (sale del patrón repetido VR1…VR12, FA): el parser da scheduled con el
 * día canónico bien puesto y el ensamblado (commit 3) lo promueve.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { ParsedTiming } from '../normalize/timing'
import { parseTiming } from '../normalize/timing'

interface GoldVisit {
  printedId: string | null
  label: string
  timing: { kind: string; value: number | null; unit: 'day' | 'week' | null }
}

const FIXTURES_DIR = fileURLToPath(new URL('../../../fixtures/soa', import.meta.url))

function goldVisits(fixture: string): GoldVisit[] {
  const gold = JSON.parse(readFileSync(`${FIXTURES_DIR}/${fixture}.gold.json`, 'utf8')) as {
    visits: GoldVisit[]
  }
  return gold.visits
}

describe('T1 — parser de tiempo sin modelo (F1–F5 al 100 %)', () => {
  it('la fila de timing de TODAS las visitas programadas de F1–F5 parsea exacta', () => {
    let scheduled = 0
    for (const fixture of ['F1', 'F2', 'F3', 'F4', 'F5']) {
      for (const visit of goldVisits(fixture)) {
        const { kind, value, unit } = visit.timing
        if (kind === 'event' || value === null || unit === null) continue
        // La fórmula del generador (generate.py paint_timing).
        const text = `${value}${unit[0]}`
        const parsed = parseTiming(text)
        expect(parsed, `${fixture} ${visit.printedId}: ${text}`).toEqual({
          kind: 'scheduled',
          value,
          unit,
        } satisfies ParsedTiming)
        scheduled++
      }
    }
    // Inventario de golds: 125 scheduled con tiempo + 4 recurrent = 129.
    // Las 3 columnas «sin número» de F3 T2 (S1-U0..U2) no tienen tiempo
    // impreso y quedan para el ensamblado (T3: «3 sin número en F3»).
    expect(scheduled).toBe(129)
  })

  it('las 3 columnas sin número de F3 T2 no tienen tiempo que parsear', () => {
    const unnumbered = goldVisits('F3').filter(
      (v) => v.timing.kind === 'scheduled' && v.timing.value === null,
    )
    expect(unnumbered).toHaveLength(3)
    expect(unnumbered.every((v) => v.printedId === null)).toBe(true)
  })

  it('los eventos («evt», la celda que imprime el generador) no llevan día', () => {
    let events = 0
    for (const fixture of ['F1', 'F2', 'F3', 'F4', 'F5']) {
      for (const visit of goldVisits(fixture)) {
        if (visit.timing.kind !== 'event') continue
        expect(parseTiming('evt')).toEqual({ kind: 'event', value: null, unit: null })
        events++
      }
    }
    expect(events).toBe(6)
  })

  it('labels e ids de eje de los golds (Día 1, Week 12, S12, D1, Day −14…)', () => {
    const cases: Array<[string, ParsedTiming]> = [
      ['Día 1', { kind: 'scheduled', value: 1, unit: 'day' }],
      ['Día 15', { kind: 'scheduled', value: 15, unit: 'day' }],
      ['Día −14', { kind: 'scheduled', value: -14, unit: 'day' }],
      ['Semana 12', { kind: 'scheduled', value: 12, unit: 'week' }],
      ['Week 12', { kind: 'scheduled', value: 12, unit: 'week' }],
      ['Day 1', { kind: 'scheduled', value: 1, unit: 'day' }],
      // S = semana (eje español de F1: llega a S104); W y D de F5.
      ['S12', { kind: 'scheduled', value: 12, unit: 'week' }],
      ['S104', { kind: 'scheduled', value: 104, unit: 'week' }],
      ['W24', { kind: 'scheduled', value: 24, unit: 'week' }],
      ['D1', { kind: 'scheduled', value: 1, unit: 'day' }],
      // Fila de timing tal como sale del PDF (con espacios de extracción).
      ['-42 d', { kind: 'scheduled', value: -42, unit: 'day' }],
      ['12 w', { kind: 'scheduled', value: 12, unit: 'week' }],
    ]
    for (const [text, expected] of cases) {
      expect(parseTiming(text), text).toEqual(expected)
    }
  })

  it('texto que no es tiempo → null (queda para el modelo, regla de oro §0)', () => {
    for (const text of ['', 'V1', 'Selección', 'n/c', '12 meses']) {
      expect(parseTiming(text), text).toBeNull()
    }
  })
})
