import { describe, expect, it } from 'vitest'
import { computeVisitWindow, visitWindowInputFromSpec } from '../visit-window'

const VALID = { anchorDate: '2025-10-01', targetDay: 21, toleranceBefore: 2, toleranceAfter: 2 }

describe('visit-window: contrato básico', () => {
  it('computa la ventana objetivo a partir del anclaje (UTC)', () => {
    const w = computeVisitWindow(VALID)
    expect(w).not.toBeNull()
    expect(w?.targetDate).toBe('2025-10-22')
    expect(w?.windowStart).toBe('2025-10-20')
    expect(w?.windowEnd).toBe('2025-10-24')
  })

  it('reporta la versión del motor', () => {
    expect(computeVisitWindow(VALID)?.version).toBe('visit-window-motor v0.1.0 (TS mirror)')
  })

  it('tolerancia cero produce ventana de un día', () => {
    const w = computeVisitWindow({
      anchorDate: '2025-10-01',
      targetDay: 7,
      toleranceBefore: 0,
      toleranceAfter: 0,
    })
    expect(w?.windowStart).toBe(w?.targetDate)
    expect(w?.windowEnd).toBe(w?.targetDate)
  })

  it('soporta targetDay negativo (visitas pre-aleatorización)', () => {
    const w = computeVisitWindow({
      anchorDate: '2025-10-01',
      targetDay: -7,
      toleranceBefore: 0,
      toleranceAfter: 0,
    })
    expect(w?.targetDate).toBe('2025-09-24')
  })
})

describe('visit-window: falla cerrada (anchor inválido → null)', () => {
  const casos: string[] = [
    'no-es-fecha',
    '01-10-2025',
    '2025-10-1',
    '20251001',
    '',
    '2025-13-01',
    '2025-02-30',
  ]
  for (const anchor of casos) {
    it(`anchor "${anchor}" → null`, () => {
      expect(computeVisitWindow({ ...VALID, anchorDate: anchor })).toBeNull()
    })
  }

  it('tolerancia negativa → null', () => {
    expect(computeVisitWindow({ ...VALID, toleranceBefore: -1 })).toBeNull()
    expect(computeVisitWindow({ ...VALID, toleranceAfter: -1 })).toBeNull()
  })

  it('targetDay decimal → null', () => {
    expect(computeVisitWindow({ ...VALID, targetDay: 21.5 })).toBeNull()
  })
})

describe('visit-window: invariantes (builder)', () => {
  const anchors = ['2025-01-01', '2025-06-15', '2025-12-31', '2028-02-28', '2024-02-29']
  const combos = [
    { targetDay: 0, toleranceBefore: 0, toleranceAfter: 0 },
    { targetDay: 1, toleranceBefore: 1, toleranceAfter: 1 },
    { targetDay: 30, toleranceBefore: 3, toleranceAfter: 2 },
    { targetDay: 365, toleranceBefore: 0, toleranceAfter: 5 },
    { targetDay: -14, toleranceBefore: 2, toleranceAfter: 0 },
  ]

  for (const anchor of anchors) {
    for (const c of combos) {
      it(`${anchor} d${c.targetDay} ±${c.toleranceBefore}/${c.toleranceAfter}: orden, formato ISO, determinismo, ancho`, () => {
        const w = computeVisitWindow({ anchorDate: anchor, ...c })
        expect(w).not.toBeNull()
        if (!w) return

        expect(w.windowStart <= w.targetDate).toBe(true)
        expect(w.targetDate <= w.windowEnd).toBe(true)

        for (const s of [w.targetDate, w.windowStart, w.windowEnd]) {
          expect(s).toMatch(/^\d{4}-\d{2}-\d{2}$/)
        }

        const w2 = computeVisitWindow({ anchorDate: anchor, ...c })
        expect(w2).toEqual(w)

        const dias =
          w.windowEnd === w.windowStart
            ? 0
            : Math.round(
                (Date.parse(`${w.windowEnd}T00:00:00.000Z`) - Date.parse(`${w.windowStart}T00:00:00.000Z`)) /
                  86_400_000,
              )
        expect(dias).toBe(c.toleranceBefore + c.toleranceAfter)
      })
    }
  }
})

describe('visitWindowInputFromSpec', () => {
  it('una spec legada con windowDays llena las dos tolerancias', () => {
    const input = visitWindowInputFromSpec(
      { day: 21, windowDays: 3, windowBefore: null, windowAfter: null },
      '2025-10-01',
    )
    expect(input).toEqual({
      anchorDate: '2025-10-01',
      targetDay: 21,
      toleranceBefore: 3,
      toleranceAfter: 3,
    })
    expect(computeVisitWindow(input!)).toMatchObject({
      targetDate: '2025-10-22',
      windowStart: '2025-10-19',
      windowEnd: '2025-10-25',
    })
  })

  it('una ventana asimétrica no se aplana al legado', () => {
    const input = visitWindowInputFromSpec(
      { day: 21, windowDays: 3, windowBefore: 2, windowAfter: 3 },
      '2025-10-01',
    )
    const w = computeVisitWindow(input!)
    expect(w?.windowStart).toBe('2025-10-20')
    expect(w?.windowEnd).toBe('2025-10-25')
  })

  it('sin día o sin ventana no arma entrada', () => {
    expect(visitWindowInputFromSpec({ day: null, windowDays: 3 }, '2025-10-01')).toBeNull()
    expect(visitWindowInputFromSpec({ day: 21, windowDays: null }, '2025-10-01')).toBeNull()
  })
})
