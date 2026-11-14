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
  it('un bloque por dato, con su rótulo, en orden: edad, presión, laboratorios, medicamentos, condiciones', () => {
    show(full)
    expect(blocks().map((b) => b.getAttribute('data-block'))).toEqual(['edad', 'presion', 'laboratorios', 'medicamentos', 'condiciones'])
    expect(titles()).toEqual(['Edad', 'Presión arterial (TA)', 'Laboratorios', 'Medicamentos', 'Condiciones'])
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
    const pressure = blocks().find((b) => b.getAttribute('data-block') === 'presion')!.textContent
    expect(pressure).toContain('132/84 mmHg')
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
})
