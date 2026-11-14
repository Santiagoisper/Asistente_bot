/**
 * @vitest-environment happy-dom
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DictationPanel } from '../dictation-panel'

/**
 * D23 en el panel: el aviso que nombra al sujeto frena «Subir un audio», y al aceptarlo el
 * selector de archivos se abre en ese mismo toque (hallazgo de Reviewer en el #162: se abría
 * recién al segundo, porque el clic programado todavía veía el aviso sin aceptar).
 */
let container: HTMLDivElement
let root: Root
/** Por cada clic que llega al selector de archivos: `true` si el panel lo frenó. */
let prevented: boolean[]
const onDocumentClick = (event: Event) => {
  if ((event.target as HTMLElement).matches?.('input[type=file]')) prevented.push(event.defaultPrevented)
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  prevented = []
  container = document.createElement('div')
  document.body.appendChild(container)
  document.addEventListener('click', onDocumentClick)
  root = createRoot(container)
  showSubject('ENSAYO-008')
})
afterEach(() => {
  document.removeEventListener('click', onDocumentClick)
  act(() => root.unmount())
  container.remove()
})

function showSubject(subjectCode: string) {
  act(() => {
    root.render(<DictationPanel subjectCode={subjectCode} onDraft={vi.fn()} onDiscard={vi.fn()} resetSignal={0} />)
  })
}

const fileInput = () => container.querySelector('input[type=file]') as HTMLInputElement
const notice = () => container.querySelector('[aria-label="Antes de grabar"]')
const button = (text: string) =>
  [...container.querySelectorAll('button')].find((candidate) => candidate.textContent === text) as HTMLButtonElement | undefined

describe('DictationPanel — el aviso antes de subir un audio', () => {
  it('sin aceptar el aviso, tocar «Subir un audio» no abre el selector y muestra el aviso con el sujeto', () => {
    act(() => fileInput().click())
    expect(prevented).toEqual([true])
    expect(notice()?.textContent).toContain('El audio que subas va a quedar en el sujeto ENSAYO-008')
  })

  it('al aceptar, el selector se abre en ese mismo toque y el aviso se va', () => {
    act(() => fileInput().click())
    act(() => button('Es ENSAYO-008, elegir el audio')!.click())
    expect(prevented).toEqual([true, false])
    expect(notice()).toBeNull()
  })

  it('«No es este sujeto» cierra el aviso y el selector sigue frenado', () => {
    act(() => fileInput().click())
    act(() => button('No es este sujeto')!.click())
    expect(notice()).toBeNull()
    act(() => fileInput().click())
    expect(prevented).toEqual([true, true])
  })

  it('una vez aceptado, las tomas siguientes de la misma evolución no vuelven a preguntar', () => {
    act(() => fileInput().click())
    act(() => button('Es ENSAYO-008, elegir el audio')!.click())
    act(() => fileInput().click())
    expect(prevented).toEqual([true, false, false])
    expect(notice()).toBeNull()
  })

  it('si cambia el sujeto con el panel abierto, lo confirmado para el anterior no vale: vuelve a preguntar y nombra al nuevo (Architect, #162)', () => {
    act(() => fileInput().click())
    act(() => button('Es ENSAYO-008, elegir el audio')!.click())
    showSubject('ENSAYO-009')
    act(() => fileInput().click())
    expect(prevented).toEqual([true, false, true])
    expect(notice()?.textContent).toContain('El audio que subas va a quedar en el sujeto ENSAYO-009')
    expect(button('Es ENSAYO-008, elegir el audio')).toBeUndefined()
  })
})
