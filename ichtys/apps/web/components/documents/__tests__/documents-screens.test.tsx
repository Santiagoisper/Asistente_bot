/**
 * @vitest-environment happy-dom
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Pantallas de documentos (auditoría 19/11, H-08, H-19 y H-20): alta de estudio, subida de
 * documentos y lista de estado. Lo que se fija: qué se manda al servidor, qué ve la persona
 * cuando algo falla (nunca un «HTTP 413» ni instrucciones de desarrollo) y que reprocesar
 * vuelve atrás si el servidor lo rechaza.
 */
const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => nav }))

import { CreateStudyForm } from '../create-study-form'
import { DocumentsStatusList, type DocumentStatusItem } from '../documents-status-list'
import { UploadZone, uploadErrorText } from '../upload-zone'

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const fetchMock = vi.fn()
let container: HTMLDivElement
let root: Root

const flush = async () => {
  for (let i = 0; i < 4; i++) await act(async () => new Promise((r) => setTimeout(r, 0)))
}
const render = async (node: React.ReactNode) => {
  await act(async () => root.render(node))
  await flush()
}
const button = (text: string) => [...container.querySelectorAll('button')].find((b) => b.textContent?.includes(text))!
const click = async (el: Element) => {
  await act(async () => (el as HTMLElement).click())
  await flush()
}
const type = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const text = () => container.textContent ?? ''
const DEV_HINTS = /pnpm dev|consola del servidor|\.env|API_KEY|HTTP \d{3}|Network error/

beforeEach(() => {
  nav.push.mockReset()
  nav.refresh.mockReset()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe('CreateStudyForm', () => {
  const open = async () => {
    await render(<CreateStudyForm />)
    await click(button('Nuevo estudio'))
  }
  const fill = async (name: string, protocol = '') => {
    await type(container.querySelector<HTMLInputElement>('#study-name')!, name)
    await type(container.querySelector<HTMLInputElement>('#protocol-number')!, protocol)
  }
  const submit = async () => {
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    await flush()
  }

  it('manda nombre y protocolo recortados y abre los documentos del estudio nuevo', async () => {
    fetchMock.mockResolvedValue(json(201, { id: 'st-9' }))
    await open()
    await fill('  Estudio X  ', '  P-1 ')
    await submit()
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/studies')
    expect(JSON.parse(init.body)).toEqual({ name: 'Estudio X', protocolNumber: 'P-1' })
    expect(nav.push).toHaveBeenCalledWith('/studies/st-9/documents')
  })

  it('sin nombre no se puede enviar, y el protocolo vacío no se manda', async () => {
    await open()
    expect(button('Crear y subir').disabled).toBe(true)
    fetchMock.mockResolvedValue(json(201, { id: 'st-1' }))
    await fill('Solo nombre')
    await submit()
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ name: 'Solo nombre' })
  })

  it.each([
    [401, 'Sesión expirada'],
    [404, 'No tenés permiso'],
    [429, 'Esperá un minuto'],
    [500, 'problema del servidor'],
  ])('HTTP %i: mensaje para la persona, sin instrucciones de desarrollo', async (status, expected) => {
    fetchMock.mockResolvedValue(json(status, {}))
    await open()
    await fill('Estudio')
    await submit()
    expect(text()).toContain(expected)
    expect(text()).not.toMatch(DEV_HINTS)
    expect(nav.push).not.toHaveBeenCalled()
  })

  it('sin conexión: lo dice sin hablar de pnpm', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await open()
    await fill('Estudio')
    await submit()
    expect(text()).toContain('Revisá tu conexión')
    expect(text()).not.toMatch(DEV_HINTS)
    error.mockRestore()
  })
})

describe('UploadZone', () => {
  class FakeXhr {
    static next: { status: number; body: string } = { status: 201, body: '{}' }
    static sent: Array<{ url: string; body: FormData }> = []
    status = 0
    responseText = ''
    upload = { addEventListener: () => undefined }
    private handlers: Record<string, () => void> = {}
    private url = ''
    addEventListener(name: string, fn: () => void) {
      this.handlers[name] = fn
    }
    open(_m: string, url: string) {
      this.url = url
    }
    send(body: FormData) {
      FakeXhr.sent.push({ url: this.url, body })
      this.status = FakeXhr.next.status
      this.responseText = FakeXhr.next.body
      setTimeout(() => this.handlers[this.status === 0 ? 'error' : 'load']?.(), 0)
    }
  }
  const choose = async (file: File) => {
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!
    await act(async () => {
      Object.defineProperty(input, 'files', { configurable: true, value: [file] })
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await flush()
  }
  const pdf = () => new File(['%PDF-1.4'], 'protocolo.pdf', { type: 'application/pdf' })

  beforeEach(() => {
    FakeXhr.sent = []
    vi.stubGlobal('XMLHttpRequest', FakeXhr)
  })

  it('un archivo que no es PDF se rechaza sin subir nada', async () => {
    await render(<UploadZone studyId="st-1" />)
    await choose(new File(['x'], 'notas.docx', { type: 'application/msword' }))
    expect(text()).toContain('solo se procesan archivos PDF')
    expect(FakeXhr.sent).toHaveLength(0)
  })

  it('sube al estudio correcto, dispara la ingesta y espera el estado real hasta «listo»', async () => {
    FakeXhr.next = { status: 201, body: JSON.stringify({ documentId: 'd1', documentVersionId: 'v1' }) }
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/ingestion/run') return json(202, {})
      if (url === '/api/documents/d1/status') return json(200, { status: 'ready', stage: 'ready' })
      return json(404, {})
    })
    const done = vi.fn()
    await render(<UploadZone studyId="st 1" onUploadComplete={done} />)
    await choose(pdf())
    expect(FakeXhr.sent[0]!.url).toBe('/api/documents/upload?studyId=st%201')
    expect(FakeXhr.sent[0]!.body.get('documentType')).toBe('protocol')
    expect(JSON.parse(fetchMock.mock.calls.find((c) => c[0] === '/api/ingestion/run')![1].body)).toEqual({ documentVersionId: 'v1' })
    expect(done).toHaveBeenCalled()
  })

  it('una subida rechazada muestra un mensaje claro, no el código HTTP', async () => {
    FakeXhr.next = { status: 413, body: 'Payload Too Large' }
    await render(<UploadZone studyId="st-1" />)
    await choose(pdf())
    expect(text()).toContain('demasiado grande')
    expect(text()).not.toMatch(DEV_HINTS)
  })

  it('si la subida termina sin ids, no muestra un éxito falso', async () => {
    FakeXhr.next = { status: 201, body: 'no es json' }
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await render(<UploadZone studyId="st-1" />)
    await choose(pdf())
    expect(text()).toContain('no se pudo iniciar el procesamiento')
    expect(fetchMock).not.toHaveBeenCalled()
    error.mockRestore()
  })

  it('uploadErrorText cubre cada caso sin mostrar códigos', () => {
    for (const status of [400, 401, 403, 404, 413, 415, 429, 500, 503]) expect(uploadErrorText(new Error(`HTTP ${status}`))).not.toMatch(DEV_HINTS)
    expect(uploadErrorText(new Error('Network error'))).toContain('conexión')
    expect(uploadErrorText('cualquier cosa')).toContain('conexión')
  })
})

describe('DocumentsStatusList', () => {
  const item = (over: Partial<DocumentStatusItem> = {}): DocumentStatusItem => ({
    documentId: 'd1',
    documentName: 'Protocolo.pdf',
    documentType: 'protocol',
    latestVersionId: 'v1',
    status: 'error',
    pageCount: 10,
    errorMessage: 'embedding_config_missing',
    createdAt: '2026-11-18T10:00:00Z',
    ...over,
  })

  it('muestra el error de ingesta en palabras de la persona, sin nombres de variables ni comandos', async () => {
    await render(<DocumentsStatusList studyId="st-1" items={[item()]} />)
    expect(text()).toContain('Falta configurar el servicio de indexación')
    expect(text()).not.toMatch(DEV_HINTS)
  })

  it('un código de error desconocido no se muestra crudo', async () => {
    await render(<DocumentsStatusList studyId="st-1" items={[item({ errorMessage: 'pg: relation chunks_tmp does not exist' })]} />)
    expect(text()).not.toContain('chunks_tmp')
    expect(text()).toContain('No pudimos procesar el documento')
  })

  it('reprocesar manda la versión y, si el servidor lo rechaza, vuelve al estado anterior con aviso', async () => {
    fetchMock.mockResolvedValue(json(500, {}))
    await render(<DocumentsStatusList studyId="st-1" items={[item()]} />)
    await click(button('Reprocesar'))
    const call = fetchMock.mock.calls.find((c) => c[0] === '/api/ingestion/run')!
    expect(JSON.parse(call[1].body)).toEqual({ documentVersionId: 'v1' })
    expect(text()).toContain('No se pudo iniciar el reprocesamiento')
    expect(button('Reprocesar')).toBeTruthy()
  })
})
