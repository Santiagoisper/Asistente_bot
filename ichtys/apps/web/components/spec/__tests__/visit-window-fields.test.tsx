/**
 * @vitest-environment happy-dom
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { VisitWindowFields, VisitWindowText, visitWindowFromDraft, windowDraftFromVisit } from '../visit-window-fields'

describe('VisitWindowFields', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
  })

  it('ofrece los campos antes y después, y el atajo simétrica', async () => {
    await act(async () => {
      root.render(<VisitWindowFields before="2" after="3" onChange={() => undefined} />)
    })
    expect(container.querySelector('[aria-label="Ventana antes"]')).toBeTruthy()
    expect(container.querySelector('[aria-label="Ventana después"]')).toBeTruthy()
    expect(container.textContent).toContain('simétrica')
  })

  it('simétrica copia el lado de antes sobre el de después', async () => {
    let next = { before: '2', after: '5' }
    await act(async () => {
      root.render(
        <VisitWindowFields
          before="2"
          after="5"
          onChange={(value) => {
            next = value
          }}
        />,
      )
    })
    const button = container.querySelector('button')
    await act(async () => {
      button?.click()
    })
    expect(next).toEqual({ before: '2', after: '2' })
  })
})

describe('texto de la ventana en la pantalla', () => {
  it('T8 imprime ±3 d para una spec legada y −2/+3 d para la asimétrica', () => {
    expect(renderToStaticMarkup(<VisitWindowText visit={{ windowDays: 3 }} />)).toContain('±3 d')
    expect(
      renderToStaticMarkup(<VisitWindowText visit={{ windowDays: 3, windowBefore: 2, windowAfter: 3 }} />),
    ).toContain('\u22122/+3 d')
  })
})

describe('borrador de la ventana', () => {
  it('una spec legada abre los dos campos con el mismo número', () => {
    expect(windowDraftFromVisit({ windowDays: 3 })).toEqual({ before: '3', after: '3' })
  })

  it('guarda la asimetría y deja windowDays en el máximo', () => {
    expect(visitWindowFromDraft('2', '3')).toEqual({
      ok: true,
      windowBefore: 2,
      windowAfter: 3,
      windowDays: 3,
    })
  })

  it('rechaza un lado que no es un entero ≥ 0', () => {
    expect(visitWindowFromDraft('-1', '3').ok).toBe(false)
    expect(visitWindowFromDraft('1,5', '3').ok).toBe(false)
  })
})
