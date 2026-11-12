import { describe, expect, it } from 'vitest'
import { applySpokenCorrections, buildDictationDraft, NOT_MENTIONED, splitIntoBlocks, trimSilence } from '../dictation'

const RATE = 16_000
function tone(seconds: number, amplitude = 0.3): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE))
  for (let i = 0; i < out.length; i++) out[i] = amplitude * Math.sin((2 * Math.PI * 220 * i) / RATE)
  return out
}
function join(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) { out.set(part, offset); offset += part.length }
  return out
}
const silence = (seconds: number) => new Float32Array(Math.round(seconds * RATE))

describe('recorte de silencios', () => {
  it('acorta un silencio largo y conserva una pausa corta', () => {
    const result = trimSilence(join(tone(1), silence(3), tone(1)), RATE)
    expect(result.removedSec).toBeGreaterThan(2.5)
    expect(result.samples.length / RATE).toBeGreaterThan(2.2)
    expect(result.samples.length / RATE).toBeLessThan(2.5)
  })

  it('no toca las pausas normales entre palabras ni un audio sin silencios', () => {
    const spoken = join(tone(1), silence(0.4), tone(1))
    expect(trimSilence(spoken, RATE).samples).toBe(spoken)
    expect(trimSilence(tone(2), RATE).removedSec).toBe(0)
  })

  it('recorta el silencio del principio y del final sin perder la voz', () => {
    const result = trimSilence(join(silence(2), tone(1), silence(2)), RATE)
    expect(result.samples.length / RATE).toBeGreaterThan(1)
    expect(result.samples.length / RATE).toBeLessThan(1.7)
  })

  it('un audio vacío vuelve igual', () => {
    expect(trimSilence(new Float32Array(0), RATE).removedSec).toBe(0)
  })
})

describe('correcciones dictadas', () => {
  it('un valor corregido reemplaza al anterior y quedan los dos a la vista', () => {
    const result = applySpokenCorrections('Presión arterial 140 sobre 90. Corrijo: 130 sobre 85. Frecuencia cardíaca 72.')
    expect(result.text).toBe('Presión arterial 130 sobre 85. Frecuencia cardíaca 72.')
    expect(result.corrections).toEqual([{ original: 'Presión arterial 140 sobre 90', corrected: 'Presión arterial 130 sobre 85', marker: 'Corrijo' }])
  })

  it('una frase corregida entera reemplaza a la anterior', () => {
    const result = applySpokenCorrections('Toma metformina 500 mg. Perdón, toma metformina 850 mg cada 12 horas.')
    expect(result.text).toBe('Toma metformina 850 mg cada 12 horas.')
    expect(result.corrections[0]?.original).toBe('Toma metformina 500 mg')
  })

  it('una marca sin nada antes o sin texto nuevo no borra nada', () => {
    expect(applySpokenCorrections('Corrijo: peso 78 kg.').corrections).toEqual([])
    expect(applySpokenCorrections('Peso 78 kg. Corrijo.').text).toBe('Peso 78 kg.')
  })

  it('sin marcas el texto no cambia', () => {
    const text = 'Paciente estable. Sin eventos adversos.'
    expect(applySpokenCorrections(text)).toEqual({ text, corrections: [] })
  })
})

describe('bloques de la evolución dictada', () => {
  it('reparte lo dictado por encabezado y marca lo que falta', () => {
    const blocks = splitIntoBlocks('Visita de selección del sujeto. Motivo: control. Signos vitales: presión 130 sobre 85. Plan. Citar en dos semanas.')
    const byId = Object.fromEntries(blocks.map((block) => [block.id, block.text]))
    expect(byId.apertura).toBe('Visita de selección del sujeto.')
    expect(byId.motivo).toBe('Control.')
    expect(byId.vitales).toBe('Presión 130 sobre 85.')
    expect(byId.plan).toBe('Citar en dos semanas.')
    expect(byId.eventos).toBeNull()
  })

  it('el encabezado vale con o sin acentos y solo al empezar la frase', () => {
    const blocks = splitIntoBlocks('Medicacion actual: metformina. Evaluación: el plan terapéutico sigue igual.')
    const byId = Object.fromEntries(blocks.map((block) => [block.id, block.text]))
    expect(byId.medicacion).toBe('Metformina.')
    expect(byId.evaluacion).toBe('El plan terapéutico sigue igual.')
    expect(byId.plan).toBeNull()
  })

  it('el borrador escribe «No mencionado» en cada bloque sin dictar y cuenta las correcciones', () => {
    const draft = buildDictationDraft('Motivo: control.  Signos vitales: presión 140 sobre 90. Corrijo: 130 sobre 85.')
    expect(draft.text).toContain('Motivo de la visita: Control.')
    expect(draft.text).toContain('Signos vitales: Presión 130 sobre 85.')
    expect(draft.text).toContain(`Eventos adversos: ${NOT_MENTIONED}`)
    expect(draft.text).not.toContain('Apertura')
    expect(draft.corrections).toHaveLength(1)
    expect(draft.missing).toContain('eventos')
    expect(draft.missing).not.toContain('motivo')
  })
})
