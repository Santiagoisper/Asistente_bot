/**
 * @vitest-environment happy-dom
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DICTATION_BLOCKS, DICTATION_GLOSSARY, studyDictationPrompts } from '@ichtys/clinical'
import { DictationGuide } from '../dictation-guide'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<DictationGuide />))
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('DictationGuide', () => {
  it('muestra cada apartado de la plantilla, en orden, con lo que hay que decir', () => {
    const items = [...container.querySelectorAll('ol > li')].map((item) => item.textContent ?? '')
    expect(items).toHaveLength(DICTATION_BLOCKS.length)
    DICTATION_BLOCKS.forEach((block, index) => {
      expect(items[index]).toContain(block.example)
      if (block.say) expect(items[index]).toContain(`«${block.say}»`)
    })
  })

  it('enseña la corrección, el cambio de apartado y el glosario', () => {
    const text = container.textContent ?? ''
    expect(text).toContain('«corrijo»')
    expect(text).toContain('«Sin novedades»')
    for (const entry of DICTATION_GLOSSARY) expect(text).toContain(entry.what)
    expect(text).toContain('apellidos')
  })

  it('se puede plegar', () => {
    expect(container.querySelector('details')?.hasAttribute('open')).toBe(true)
    expect(container.querySelector('aside')?.getAttribute('aria-label')).toBe('Guía para dictar')
  })
})

describe('DictationGuide — lo que pide este estudio', () => {
  const prompts = studyDictationPrompts([
    { criterionNumber: '2.3', status: 'unknown', missing: ['weight-height'] },
    { criterionNumber: '3.1', status: 'unknown', missing: ['egfr'] },
    { criterionNumber: '3.3', status: 'unknown', missing: ['pancreatitis'] },
    { criterionNumber: '3.4', status: 'unknown', missing: ['pregnancy', 'lactation'] },
  ])
  const text = () => container.textContent ?? ''

  it('sin datos que falten no agrega nada', () => {
    expect(text()).not.toContain('Para este estudio')
  })

  it('muestra qué falta, cómo decirlo y qué criterio lo pide', () => {
    act(() => root.render(<DictationGuide studyPrompts={prompts} />))
    expect(text()).toContain('Para este estudio, decí también')
    expect(text()).toContain('El peso y la talla')
    expect(text()).toContain('«Peso 78 kilos.» «Talla 1 metro 63.»')
    expect(text()).toContain('(criterio 2.3)')
  })

  it('para una exclusión muestra las dos frases: la que la despeja y la que la activa', () => {
    act(() => root.render(<DictationGuide studyPrompts={prompts} />))
    expect(text()).toContain('Si no: «Sin antecedentes de pancreatitis.»')
    expect(text()).toContain('Si sí: «Antecedente de pancreatitis.»')
    expect(text()).toContain('Si sí: «Embarazo en curso.» o «Lactancia en curso.»')
  })

  it('lo que no se dicta lo dice, sin frase para repetir', () => {
    act(() => root.render(<DictationGuide studyPrompts={prompts} />))
    expect(text()).toContain('No se dicta: se resuelve al cargar el laboratorio.')
  })

  it('avisa cuando el protocolo extraído no está aprobado, y solo entonces', () => {
    act(() => root.render(<DictationGuide studyPrompts={prompts} />))
    expect(text()).not.toContain('nadie aprobó')
    act(() => root.render(<DictationGuide studyPrompts={prompts} unapprovedProtocol />))
    expect(text()).toContain('Sale de criterios del protocolo que nadie aprobó todavía.')
  })

  it('queda arriba de los apartados: es lo primero que se lee', () => {
    act(() => root.render(<DictationGuide studyPrompts={prompts} />))
    const titles = [...container.querySelectorAll('h4')].map((title) => title.textContent)
    expect(titles[0]).toBe('Para este estudio, decí también')
  })
})

describe('DictationGuide — lo que el cronograma del protocolo pide en esta visita', () => {
  const visit = {
    name: 'Visita 3',
    label: 'Semana 4',
    procedures: ['Signos vitales', 'Electrocardiograma (ECG)', 'Registro de eventos adversos'],
    sourcePages: [41, 42],
  }
  const text = () => container.textContent ?? ''

  it('sin cronograma en el protocolo no agrega nada', () => {
    expect(text()).not.toContain('En esta visita')
    expect(text()).not.toContain('qué visita es')
  })

  it('muestra la visita, cada procedimiento y la página del protocolo', () => {
    act(() => root.render(<DictationGuide visit={visit} visitsAvailable />))
    expect(text()).toContain('En esta visita, el protocolo pide')
    expect(text()).toContain('Visita 3 · Semana 4')
    for (const procedure of visit.procedures) expect(text()).toContain(procedure)
    expect(text()).toContain('pp. 41, 42 del protocolo')
  })

  it('dice que es un recordatorio: el sistema no comprueba que estén en el texto', () => {
    act(() => root.render(<DictationGuide visit={visit} visitsAvailable />))
    expect(text()).toContain('Es un recordatorio: el sistema no comprueba que cada uno figure en lo que dictás.')
  })

  it('con cronograma pero sin visita reconocida, dice dónde escribirla', () => {
    act(() => root.render(<DictationGuide visitsAvailable />))
    expect(text()).not.toContain('En esta visita, el protocolo pide')
    expect(text()).toContain('Escribí qué visita es, debajo del cuadro, y acá aparece lo que el protocolo pide para esa visita.')
  })

  it('una visita sin procedimientos en el cronograma lo dice, no muestra una lista vacía', () => {
    act(() => root.render(<DictationGuide visit={{ ...visit, procedures: [] }} visitsAvailable />))
    expect(text()).toContain('El cronograma extraído no trae procedimientos para esta visita.')
  })

  it('una lista larga muestra doce y guarda el resto plegado, sin perder ninguno', () => {
    const many = Array.from({ length: 15 }, (_, index) => `Procedimiento ${index + 1}`)
    act(() => root.render(<DictationGuide visit={{ ...visit, procedures: many }} visitsAvailable />))
    expect(text()).toContain('y 3 más')
    for (const procedure of many) expect(text()).toContain(procedure)
  })

  it('avisa cuando el protocolo extraído no está aprobado, y solo entonces', () => {
    act(() => root.render(<DictationGuide visit={visit} visitsAvailable />))
    expect(text()).not.toContain('nadie aprobó')
    act(() => root.render(<DictationGuide visit={visit} visitsAvailable unapprovedProtocol />))
    expect(text()).toContain('Sale del cronograma de un protocolo que nadie aprobó todavía.')
  })

  it('va después de lo que falta para los criterios y antes de los apartados', () => {
    const prompts = studyDictationPrompts([{ criterionNumber: '2.3', status: 'unknown', missing: ['weight-height'] }])
    act(() => root.render(<DictationGuide studyPrompts={prompts} visit={visit} visitsAvailable />))
    const titles = [...container.querySelectorAll('h4')].map((title) => title.textContent)
    expect(titles.slice(0, 3)).toEqual(['Para este estudio, decí también', 'En esta visita, el protocolo pide', 'Decí el apartado y después el dato'])
  })
})
