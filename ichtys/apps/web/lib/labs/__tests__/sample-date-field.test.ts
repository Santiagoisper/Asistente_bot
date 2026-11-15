import { describe, expect, it } from 'vitest'
import { initialSampleDateField, sampleDateDecision, sampleDateHelp, sampleDateMax } from '../sample-date-field'

/**
 * El campo «Fecha de la muestra» de la pantalla de revisión (C4, D3). El lector propone, la
 * persona confirma, escribe o declara que el informe no la trae. Sin una de esas tres cosas no
 * se confirma: dejarla vacía sin decirlo no puede ser lo que pasa por defecto.
 */
const today = '2026-11-14'

describe('initialSampleDateField', () => {
  it('con una fecha leída en el informe, arranca con esa propuesta', () => {
    expect(initialSampleDateField(['Fecha de extracción: 24/09/2026', 'Glucosa 92'])).toEqual({ value: '2026-09-24', unknown: false, proposed: '2026-09-24' })
  })

  it('sin renglón de muestra arranca vacío: no usa la fecha de emisión ni la de hoy', () => {
    expect(initialSampleDateField(['Fecha de emisión: 25/09/2026'])).toEqual({ value: '', unknown: false, proposed: null })
  })
})

describe('sampleDateDecision', () => {
  it('la propuesta sin tocar se confirma con el resto', () => {
    expect(sampleDateDecision({ value: '2026-09-24', unknown: false, proposed: '2026-09-24' }, today)).toEqual({ ok: true, sampleDate: '2026-09-24' })
  })

  it('una fecha escrita por la persona', () => {
    expect(sampleDateDecision({ value: '2026-10-01', unknown: false, proposed: null }, today)).toEqual({ ok: true, sampleDate: '2026-10-01' })
  })

  it('declarada como desconocida viaja null, aunque haya quedado algo escrito', () => {
    expect(sampleDateDecision({ value: '', unknown: true, proposed: null }, today)).toEqual({ ok: true, sampleDate: null })
    expect(sampleDateDecision({ value: '2026-09-24', unknown: true, proposed: '2026-09-24' }, today)).toEqual({ ok: true, sampleDate: null })
  })

  it('vacía y sin declarar: falta decidir', () => {
    expect(sampleDateDecision({ value: '', unknown: false, proposed: null }, today)).toEqual({ ok: false, reason: 'missing' })
  })

  it('futura o imposible: no se puede confirmar', () => {
    expect(sampleDateDecision({ value: '2027-01-01', unknown: false, proposed: null }, today)).toEqual({ ok: false, reason: 'invalid' })
    expect(sampleDateDecision({ value: '2026-02-31', unknown: false, proposed: null }, today)).toEqual({ ok: false, reason: 'invalid' })
  })
})

describe('sampleDateHelp — lo que se lee debajo del campo', () => {
  it('propuesta sin tocar: dice de dónde salió y pide comprobarla', () => {
    expect(sampleDateHelp({ value: '2026-09-24', unknown: false, proposed: '2026-09-24' })).toBe('Leída del informe. Comprobala contra el informe antes de confirmar.')
  })

  it('la persona la cambió: ya no dice que es la leída', () => {
    expect(sampleDateHelp({ value: '2026-09-23', unknown: false, proposed: '2026-09-24' })).toBe('La escribiste vos. En el informe se leyó 24/09/2026.')
  })

  it('la persona la borró: no dice que la escribió, y recuerda lo leído', () => {
    expect(sampleDateHelp({ value: '', unknown: false, proposed: '2026-09-24' })).toBe('La borraste. En el informe se leyó 24/09/2026.')
  })

  it('sin propuesta: dice que no se encontró y qué fecha es', () => {
    expect(sampleDateHelp({ value: '', unknown: false, proposed: null })).toBe('No se encontró en el informe. Es la fecha de extracción o toma de la muestra, no la de emisión.')
  })

  it('desconocida: dice qué queda guardado', () => {
    expect(sampleDateHelp({ value: '', unknown: true, proposed: null })).toBe('Los valores quedan guardados con fecha de muestra desconocida.')
  })
})

describe('sampleDateMax — el calendario no ofrece menos que lo que el campo acepta', () => {
  it('la última fecha del calendario se puede confirmar, y la siguiente no', () => {
    expect(sampleDateMax(today)).toBe('2026-11-15')
    expect(sampleDateDecision({ value: '2026-11-15', unknown: false, proposed: null }, today)).toEqual({ ok: true, sampleDate: '2026-11-15' })
    expect(sampleDateDecision({ value: '2026-11-16', unknown: false, proposed: null }, today)).toEqual({ ok: false, reason: 'invalid' })
  })
})
