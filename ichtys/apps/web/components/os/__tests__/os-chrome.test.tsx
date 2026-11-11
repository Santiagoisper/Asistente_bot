/**
 * @vitest-environment happy-dom
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const nav = vi.hoisted(() => ({ pathname: '/inicio' }))
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname }))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) =>
    React.createElement('a', { href, ...rest }, children),
}))

import { OsChrome } from '../os-chrome'

let container: HTMLDivElement
let root: Root

function render(pathname: string, priorityCount: number | null) {
  nav.pathname = pathname
  act(() => {
    root.render(
      <OsChrome orgSwitcher={<span>org</span>} userButton={<span>user</span>} priorityCount={priorityCount}>
        <p>contenido</p>
      </OsChrome>,
    )
  })
}

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

describe('cáscara del OS', () => {
  it('marca como actual el módulo de la ruta, también en subrutas', () => {
    render('/studies/abc/chat', 0)
    const current = Array.from(container.querySelectorAll('nav[aria-label="Módulos"] a[aria-current="page"]'))
    expect(current.map((link) => link.textContent)).toEqual(['Protocolos'])
  })

  it('muestra los diez módulos y rotula los que todavía no existen', () => {
    render('/inicio', 0)
    const links = Array.from(container.querySelectorAll('nav[aria-label="Módulos"] a'))
    expect(links).toHaveLength(10)
    const soon = links.filter((link) => link.textContent?.includes('Próximamente')).map((link) => link.getAttribute('href'))
    expect(soon).toEqual(['/visitas', '/metricas'])
  })

  it('la campana dice cuántos ítems hay y no muestra globo en cero', () => {
    render('/inicio', 3)
    const bell = container.querySelector('a[href="/inicio#atencion-prioritaria"]')
    expect(bell?.getAttribute('aria-label')).toBe('Atención prioritaria: 3 ítems')
    expect(bell?.textContent).toBe('3')

    render('/inicio', 0)
    const empty = container.querySelector('a[href="/inicio#atencion-prioritaria"]')
    expect(empty?.getAttribute('aria-label')).toBe('Atención prioritaria: nada pendiente')
    expect(empty?.textContent).toBe('')
  })

  it('si la cantidad no se pudo calcular, la campana no inventa un número', () => {
    render('/inicio', null)
    const bell = container.querySelector('a[href="/inicio#atencion-prioritaria"]')
    expect(bell?.getAttribute('aria-label')).toBe('Atención prioritaria')
    expect(bell?.textContent).toBe('')
  })

  it('el menú móvil se abre y se cierra', () => {
    render('/inicio', 0)
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    act(() => (container.querySelector('button[aria-label="Abrir el menú"]') as HTMLButtonElement).click())
    expect(container.querySelector('[role="dialog"]')).not.toBeNull()
    act(() => (container.querySelector('[role="dialog"] button[aria-label="Cerrar el menú"]') as HTMLButtonElement).click())
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })
})
