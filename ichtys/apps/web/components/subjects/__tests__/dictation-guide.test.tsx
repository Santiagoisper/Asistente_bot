/**
 * @vitest-environment happy-dom
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DICTATION_BLOCKS, DICTATION_GLOSSARY } from '@ichtys/clinical'
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
