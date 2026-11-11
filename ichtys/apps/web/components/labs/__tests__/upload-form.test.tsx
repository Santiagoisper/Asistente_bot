/**
 * @vitest-environment happy-dom
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const push = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

import { LabUploadForm } from '../upload-form'

const EMPTY = { id: 'study-empty', label: 'PROTO-1 · Estudio sin sujetos', subjectCount: 0 }
const WITH = { id: 'study-with', label: 'PROTO-2 · Estudio con sujetos', subjectCount: 2 }
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('LabUploadForm — cargar estudio de laboratorio', () => {
  let container: HTMLDivElement
  let root: Root
  let subjectsByStudy: Record<string, Array<{ id: string; subjectCode: string }>>
  let createStatus: number
  const fetchMock = vi.fn()

  const flush = async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
  const render = async (studies: Array<typeof EMPTY>) => {
    await act(async () => {
      root.render(<LabUploadForm studies={studies} />)
    })
    await flush()
  }
  const submitButton = () => container.querySelector<HTMLButtonElement>('button[type="submit"]')!
  const buttonByText = (text: string) => [...container.querySelectorAll('button')].find((button) => button.textContent?.includes(text))
  const type = async (input: HTMLInputElement, value: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  const chooseFile = async (file: File) => {
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!
    await act(async () => {
      Object.defineProperty(input, 'files', { configurable: true, value: [file] })
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
  }

  beforeEach(() => {
    subjectsByStudy = { 'study-empty': [], 'study-with': [{ id: 'subj-2', subjectCode: '001-002' }, { id: 'subj-1', subjectCode: '001-001' }] }
    createStatus = 201
    push.mockReset()
    fetchMock.mockReset()
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const subjectsMatch = url.match(/^\/api\/studies\/([^/]+)\/subjects$/)
      if (subjectsMatch && (!init || init.method === undefined)) return json(200, subjectsByStudy[subjectsMatch[1]!] ?? [])
      if (subjectsMatch && init?.method === 'POST') {
        if (createStatus !== 201) return json(createStatus, { error: 'subject_code_exists' })
        const code = String((JSON.parse(String(init.body)) as { subjectCode: string }).subjectCode).toUpperCase()
        return json(201, { id: 'subj-new', subjectCode: code, status: 'screening' })
      }
      if (/\/lab-reports$/.test(url) && init?.method === 'POST') return json(201, { reportId: 'rep-1', rowCount: 3, reviewCount: 0, newFieldCount: 3 })
      return json(404, {})
    })
    vi.stubGlobal('fetch', fetchMock)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    vi.unstubAllGlobals()
  })

  it('arranca en un estudio que ya tiene sujetos y muestra cuántos tiene cada uno', async () => {
    await render([WITH, EMPTY])
    const study = container.querySelector<HTMLSelectElement>('select')!
    expect(study.value).toBe('study-with')
    expect(study.textContent).toContain('PROTO-2 · Estudio con sujetos — 2 sujetos')
    expect(study.textContent).toContain('PROTO-1 · Estudio sin sujetos — sin sujetos')
    const subject = container.querySelectorAll<HTMLSelectElement>('select')[1]!
    expect([...subject.options].map((option) => option.textContent)).toEqual(['001-001', '001-002'])
    expect(container.textContent).toContain('Falta elegir el PDF.')
  })

  it('un estudio sin sujetos dice por qué no se puede leer y ofrece crearlo ahí mismo', async () => {
    await render([EMPTY])
    expect(submitButton().disabled).toBe(true)
    expect(container.textContent).toContain('Este estudio todavía no tiene sujetos')
    expect(container.textContent).toContain('Falta crear el sujeto y elegir el PDF.')
    expect(buttonByText('Crear sujeto')).toBeTruthy()
  })

  it('crea el sujeto, lo deja elegido, y con el PDF habilita y envía la lectura', async () => {
    await render([EMPTY])
    await type(container.querySelector<HTMLInputElement>('input[autocomplete="off"]')!, ' 001-014 ')
    await act(async () => {
      buttonByText('Crear sujeto')!.click()
    })
    await flush()

    const created = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'POST')!
    expect(created[0]).toBe('/api/studies/study-empty/subjects')
    expect(JSON.parse(String((created[1] as RequestInit).body))).toEqual({ subjectCode: '001-014' })
    const subject = container.querySelectorAll<HTMLSelectElement>('select')[1]!
    expect(subject.value).toBe('subj-new')
    expect(container.textContent).not.toContain('Este estudio todavía no tiene sujetos')
    expect(container.querySelector('select')!.textContent).toContain('— 1 sujeto')
    expect(submitButton().disabled).toBe(true)
    expect(container.textContent).toContain('Falta elegir el PDF.')

    await chooseFile(new File(['%PDF-1.4'], 'informe.pdf', { type: 'application/pdf' }))
    expect(submitButton().disabled).toBe(false)
    expect(container.textContent).not.toContain('Falta ')

    await act(async () => {
      container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    await flush()
    const upload = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/lab-reports'))!
    expect(upload[0]).toBe('/api/studies/study-empty/subjects/subj-new/lab-reports')
    expect((upload[1] as RequestInit).body).toBeInstanceOf(FormData)
    expect(push).toHaveBeenCalledWith('/studies/study-empty/subjects/subj-new/labs/rep-1')
  })

  it('un código inválido se avisa sin llamar al servidor, y uno repetido muestra el motivo', async () => {
    await render([EMPTY])
    const input = container.querySelector<HTMLInputElement>('input[autocomplete="off"]')!
    await type(input, 'Juan Pérez')
    await act(async () => {
      buttonByText('Crear sujeto')!.click()
    })
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Usá solo letras, números y guiones.')
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'POST')).toBe(false)

    createStatus = 409
    await type(input, '001-001')
    await act(async () => {
      buttonByText('Crear sujeto')!.click()
    })
    await flush()
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Ya hay un sujeto con ese código en este estudio.')
    expect(submitButton().disabled).toBe(true)
  })

  it('un archivo demasiado grande o que no es PDF se rechaza antes de subirlo', async () => {
    await render([WITH])
    await chooseFile(new File([new Uint8Array(4 * 1024 * 1024 + 1)], 'grande.pdf', { type: 'application/pdf' }))
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('El archivo pesa más de 4 MB.')
    await chooseFile(new File(['x'], 'foto.png', { type: 'image/png' }))
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('El archivo no es un PDF.')
    expect(submitButton().disabled).toBe(true)
  })

  it('si la lista de sujetos falla, se puede reintentar', async () => {
    fetchMock.mockImplementationOnce(async () => json(500, {}))
    await render([WITH])
    expect(container.textContent).toContain('Falta recargar la lista de sujetos y elegir el PDF.')
    await act(async () => {
      buttonByText('Reintentar')!.click()
    })
    await flush()
    expect(container.querySelectorAll<HTMLSelectElement>('select')[1]!.value).toBe('subj-1')
  })
})
