/**
 * @vitest-environment happy-dom
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CabinaApp } from '../cabina-app'

function desktopMedia(matches: boolean): void {
  const listeners = new Set<() => void>()
  window.matchMedia = (query: string) => {
    const media = {
      matches: query.includes('min-width: 768px') ? matches : false,
      media: query,
      onchange: null,
      addEventListener: (_type: string, listener: EventListener) => {
        listeners.add(listener as () => void)
      },
      removeEventListener: (_type: string, listener: EventListener) => {
        listeners.delete(listener as () => void)
      },
      addListener: (listener: () => void) => {
        listeners.add(listener)
      },
      removeListener: (listener: () => void) => {
        listeners.delete(listener)
      },
      dispatchEvent: () => {
        for (const listener of listeners) listener()
        return true
      },
    }
    return media as unknown as MediaQueryList
  }
}

function dayList(): HTMLElement {
  const list = document.querySelector('[aria-label="Checklist del día"]')
  if (!(list instanceof HTMLElement)) throw new Error('falta el checklist del día')
  return list
}

function firstRow(): HTMLElement {
  const row = dayList().querySelector('li')
  if (!(row instanceof HTMLElement)) throw new Error('el checklist del día no tiene filas')
  return row
}

function quoteDialog(): HTMLElement | null {
  const dialog = document.getElementById('origen-title')?.closest('[role="dialog"]')
  return dialog instanceof HTMLElement ? dialog : null
}

function backdrop(): HTMLElement | null {
  const button = document.querySelector('[aria-label="Cerrar el texto de la página"]')
  return button instanceof HTMLElement ? button : null
}

async function renderApp(root: Root): Promise<void> {
  await act(async () => {
    root.render(<CabinaApp />)
  })
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.click()
  })
}

describe('checklist y panel de la cita', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    host.remove()
  })

  it('marcar una casilla no abre el panel y el chip sí', async () => {
    desktopMedia(true)
    await renderApp(root)
    const row = firstRow()
    const box = row.querySelector('input[type="checkbox"]')
    if (!(box instanceof HTMLInputElement)) throw new Error('falta la casilla')
    await click(box)
    expect(box.checked).toBe(true)
    expect(quoteDialog()).toBeNull()

    const chip = [...row.querySelectorAll('button')].find((button) => button.textContent?.trim().startsWith('p. '))
    if (!chip) throw new Error('falta el chip de página')
    await click(chip)
    expect(quoteDialog()).not.toBeNull()
  })

  it('el botón Ver cita abre el panel y la casilla sigue sin abrirlo', async () => {
    desktopMedia(true)
    await renderApp(root)
    const row = firstRow()
    const quote = [...row.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Ver cita')
    if (!quote) throw new Error('falta Ver cita')
    const box = row.querySelector('input[type="checkbox"]')
    expect(box?.contains(quote)).toBe(false)
    expect(box?.parentElement?.contains(quote)).toBe(false)
    await click(quote)
    expect(quoteDialog()).not.toBeNull()
  })

  it('en escritorio el panel lateral no tapa Preguntar ni la navegación', async () => {
    desktopMedia(true)
    await renderApp(root)
    const chip = [...firstRow().querySelectorAll('button')].find((button) => button.textContent?.trim().startsWith('p. '))
    if (!chip) throw new Error('falta el chip de página')
    await click(chip)
    expect(backdrop()).toBeNull()
    expect(quoteDialog()?.getAttribute('aria-modal')).toBe('false')

    const ask = document.getElementById('cabina-pregunta')
    if (!(ask instanceof HTMLInputElement)) throw new Error('falta la pregunta')
    await act(async () => {
      ask.focus()
    })
    expect(document.activeElement).toBe(ask)

    const nav = document.querySelector('[aria-label="Navegación de la demo"]')
    if (!(nav instanceof HTMLElement)) throw new Error('falta la navegación')
    const navAsk = [...nav.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Preguntar')
    if (!navAsk) throw new Error('falta Preguntar en la navegación')
    await act(async () => {
      navAsk.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(document.activeElement).toBe(ask)
    expect(quoteDialog()).not.toBeNull()
  })

  it('en pantalla chica el panel es modal: el fondo está, Escape cierra y el tabulador no sale', async () => {
    desktopMedia(false)
    await renderApp(root)
    const chip = [...firstRow().querySelectorAll('button')].find((button) => button.textContent?.trim().startsWith('p. '))
    if (!chip) throw new Error('falta el chip de página')
    await click(chip)
    const dialog = quoteDialog()
    expect(dialog).not.toBeNull()
    expect(dialog?.getAttribute('aria-modal')).toBe('true')
    expect(backdrop()).not.toBeNull()

    const focusable = [...(dialog?.querySelectorAll('button, textarea, input, select, a[href]') ?? [])].filter(
      (node): node is HTMLElement => node instanceof HTMLElement && !node.hasAttribute('disabled'),
    )
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (!first || !last) throw new Error('el panel no tiene controles')
    await act(async () => {
      last.focus()
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    })
    expect(document.activeElement).toBe(first)

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(quoteDialog()).toBeNull()
  })
})
