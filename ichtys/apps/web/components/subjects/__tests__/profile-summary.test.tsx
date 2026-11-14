/**
 * @vitest-environment happy-dom
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProfileSummary } from '../profile-summary'

/**
 * El perfil extraído, por bloques con su rótulo (pedido de Santiago, 14/11/2026): cada bloque
 * se distingue del siguiente, en el orden en que la historia clínica del centro los guarda.
 */
let container: HTMLDivElement
let root: Root
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const full = {
  demographics: { ageYears: 58 },
  vitals: { bloodPressureLabel: '130/85', systolic: 132, diastolic: 84 },
  labs: [{ name: 'HbA1c', value: 7.9, unit: '%' }, { name: 'Glucosa', value: 110 }],
  medications: [{ name: 'Metformina', dose: '850 mg', frequency: 'cada 12 horas' }],
  conditions: ['Diabetes tipo 2'],
}
type Props = React.ComponentProps<typeof ProfileSummary>
const show = (profile: Props['profile'], badge?: Props['badge']) => act(() => root.render(<ProfileSummary profile={profile} badge={badge} />))
const blocks = () => Array.from(container.querySelectorAll('[data-block]'))
const titles = () => blocks().map((b) => b.querySelector('dt')?.textContent?.trim())

describe('ProfileSummary', () => {
  it('un bloque por dato, con su rótulo, en el orden de las pestañas de la historia clínica del centro', () => {
    show(full)
    // Alpha CR: patologías, medicamentos, laboratorios, signos vitales (relevado el 14/11/2026).
    expect(blocks().map((b) => b.getAttribute('data-block'))).toEqual(['edad', 'condiciones', 'medicamentos', 'laboratorios', 'vitales'])
    expect(titles()).toEqual(['Edad', 'Condiciones', 'Medicamentos', 'Laboratorios', 'Signos vitales'])
  })

  it('el rótulo va en negrita y cada bloque se separa del anterior', () => {
    show(full)
    for (const block of blocks()) {
      expect(block.querySelector('dt')!.className).toContain('font-bold')
      expect(block.className).toContain('border-t')
    }
  })

  it('la presión que se muestra es la guardada en números, no la etiqueta que puede quedar vieja', () => {
    show(full)
    const pressure = blocks().find((b) => b.getAttribute('data-block') === 'vitales')!.textContent
    expect(pressure).toContain('Presión arterial (TA): 132/84 mmHg')
    expect(pressure).not.toContain('130/85')
  })

  it('cada laboratorio y cada medicamento en su renglón, con unidad, dosis y frecuencia', () => {
    show(full)
    const text = container.textContent ?? ''
    expect(text).toContain('HbA1c: 7.9 %')
    expect(text).toContain('Glucosa: 110')
    expect(text).toContain('Metformina 850 mg — cada 12 horas')
  })

  it('un bloque sin datos no aparece: no se muestra un rótulo vacío', () => {
    show({ labs: [], medications: [], conditions: ['Hipotiroidismo'] })
    expect(blocks().map((b) => b.getAttribute('data-block'))).toEqual(['condiciones'])
  })

  it('la confianza de cada dato se muestra donde corresponde', () => {
    show({ ...full, fieldConfidence: { ageYears: 'high', labs: { hba1c: 'low' } } }, (level) => (level ? <em data-level={level}>{level}</em> : null))
    expect(blocks()[0]!.querySelector('[data-level="high"]')).not.toBeNull()
    expect(container.querySelectorAll('[data-level="low"]')).toHaveLength(1)
  })

  it('peso y talla van a antropometría y la frecuencia cardíaca a signos vitales: no se muestran como laboratorios', () => {
    show({
      ...full,
      labs: [
        { name: 'Peso', value: 78, unit: 'kg' },
        { name: 'HbA1c', value: 7.9, unit: '%' },
        { name: 'Talla', value: 163, unit: 'cm' },
        { name: 'Frecuencia cardíaca', value: 72, unit: 'lpm' },
      ],
    })
    const of = (id: string) => blocks().find((b) => b.getAttribute('data-block') === id)?.textContent ?? ''
    expect(blocks().map((b) => b.getAttribute('data-block'))).toEqual(['edad', 'condiciones', 'medicamentos', 'laboratorios', 'vitales', 'antropometria'])
    expect(of('antropometria')).toContain('Peso: 78 kg')
    expect(of('antropometria')).toContain('Talla: 163 cm')
    expect(of('vitales')).toContain('Frecuencia cardíaca: 72 lpm')
    expect(of('vitales')).toContain('132/84 mmHg')
    expect(of('laboratorios')).toContain('HbA1c: 7.9 %')
    expect(of('laboratorios')).not.toContain('Peso')
    expect(of('laboratorios')).not.toContain('Frecuencia')
  })

  it('ningún dato se pierde al repartirlo: lo que entra en laboratorios sale en algún bloque, una vez', () => {
    const labs = [{ name: 'Peso', value: 78 }, { name: 'Peso molecular', value: 3 }, { name: 'FR', value: 16 }, { name: 'Glucemia', value: 132 }]
    show({ labs, medications: [], conditions: [] })
    const text = container.textContent ?? ''
    for (const lab of labs) expect(text.split(`${lab.name}: ${lab.value}`).length - 1, lab.name).toBe(1)
  })

  it('con frecuencia cardíaca y sin presión, signos vitales aparece igual', () => {
    show({ labs: [{ name: 'FC', value: 80 }], medications: [], conditions: [] })
    expect(blocks().map((b) => b.getAttribute('data-block'))).toEqual(['vitales'])
  })

  it('la confianza de un dato lo acompaña al bloque donde se muestra', () => {
    show({ labs: [{ name: 'Peso', value: 78 }], medications: [], conditions: [], fieldConfidence: { labs: { peso: 'low' } } }, (level) => (level ? <em data-level={level}>{level}</em> : null))
    expect(blocks()[0]!.getAttribute('data-block')).toBe('antropometria')
    expect(blocks()[0]!.querySelector('[data-level="low"]')).not.toBeNull()
  })
})
