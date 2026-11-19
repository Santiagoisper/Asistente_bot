/**
 * @vitest-environment happy-dom
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** Biblioteca de protocolos (auditoría 19/11, H-08): búsqueda, filtros por estado de la spec y enlaces. */
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

import { LibraryClient, type LibraryRow } from '../library-client'

let container: HTMLDivElement
let root: Root
const row = (over: Partial<LibraryRow>): LibraryRow => ({
  studyId: 'st-1',
  name: 'Estudio Uno',
  protocolCode: 'P-100',
  title: 'Tirzepatida fase 3',
  phase: '3',
  specStatus: 'approved',
  indexedDocs: 2,
  inclusionCount: 10,
  exclusionCount: 20,
  endpointCount: 3,
  visitCount: 12,
  terminology: [],
  createdAt: '2026-11-01T00:00:00Z',
  ...over,
})
const rows = [
  row({}),
  row({ studyId: 'st-2', name: 'Estudio Dos', protocolCode: 'ZX-7', title: null, phase: '2', specStatus: 'draft', specPartial: true }),
  row({ studyId: 'st-3', name: 'Estudio Tres', protocolCode: null, title: null, phase: null, specStatus: null }),
]
const names = () => [...container.querySelectorAll('h2')].map((h) => h.textContent)
const render = async (r: LibraryRow[]) => act(async () => root.render(<LibraryClient rows={r} />))
const filter = async (label: string) =>
  act(async () => [...container.querySelectorAll('button')].find((b) => b.textContent === label)!.click())
const search = async (value: string) => {
  const input = container.querySelector<HTMLInputElement>('input[type="search"]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('LibraryClient', () => {
  it('vacía: invita a importar', async () => {
    await render([])
    expect(container.querySelector('a[href="/studies/import"]')).toBeTruthy()
  })

  it('filtra por estado de la spec', async () => {
    await render(rows)
    await filter('Spec aprobado')
    expect(names()).toEqual(['Estudio Uno'])
    await filter('Borrador')
    expect(names()).toEqual(['Estudio Dos'])
    await filter('Sin spec')
    expect(names()).toEqual(['Estudio Tres'])
    await filter('Todos')
    expect(names()).toHaveLength(3)
  })

  it('busca por nombre, código o título sin distinguir mayúsculas, y avisa si no hay coincidencias', async () => {
    await render(rows)
    await search('zx-7')
    expect(names()).toEqual(['Estudio Dos'])
    await search('TIRZEPATIDA')
    expect(names()).toEqual(['Estudio Uno'])
    await search('nada que ver')
    expect(container.textContent).toContain('No hay protocolos que coincidan')
  })

  it('marca la spec parcial y enlaza al chat, la spec y los documentos de cada estudio', async () => {
    await render(rows)
    expect(container.textContent).toContain('Spec parcial')
    for (const href of ['/studies/st-2/chat', '/studies/st-2/spec', '/studies/st-2/documents']) expect(container.querySelector(`a[href="${href}"]`)).toBeTruthy()
  })

  it('muestra hasta 8 términos y cuenta el resto', async () => {
    const terminology = Array.from({ length: 11 }, (_, i) => ({ system: 'LOINC' as const, code: `c${i}`, display: `Término ${i}` }))
    await render([row({ terminology })])
    expect(container.textContent).toContain('+3')
    expect(container.textContent).not.toContain('Término 8')
  })
})
