import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  configured: new Set<string>(),
  runWithLlmFallback: vi.fn(),
  recordUsage: vi.fn(async () => undefined),
  generateObject: vi.fn(),
}))

vi.mock('@ichtys/db', () => ({ getOrgLlmApiKeys: vi.fn(async () => null), recordUsage: mocks.recordUsage }))
vi.mock('@ichtys/llm', () => ({
  isProviderConfigured: (provider: string) => mocks.configured.has(provider),
  runWithLlmFallback: mocks.runWithLlmFallback,
  // La tabla real se fija en packages/llm/__tests__/chain.test.ts.
  PROVIDERS_BY_PURPOSE: { 'lab-read': ['anthropic'], 'lab-read-control': ['anthropic'] },
}))
vi.mock('ai', () => ({ generateObject: mocks.generateObject }))

import { readImagesWithModel, readTextWithModel, secondReaderEnabled } from '../lab-model-reader'

const scope = { orgId: 'org-1', studyId: 'study-1' }
const image = { mime: 'image/jpeg' as const, data: new Uint8Array([0xff, 0xd8, 0xff]) }
const saved = process.env.LAB_SECOND_READER

/** Simula el helper de proveedores: ejecuta la llamada con el proveedor pedido. */
function providerAnswers(answers: Record<string, unknown>) {
  mocks.runWithLlmFallback.mockImplementation(async (options: { providerPreference: string }, run: (model: unknown, provider: string, report: (usage: unknown) => void, signal: AbortSignal) => Promise<unknown>) => {
    const answer = answers[options.providerPreference]
    if (answer instanceof Error) throw answer
    mocks.generateObject.mockResolvedValueOnce({ object: answer, usage: { inputTokens: 10, outputTokens: 5 } })
    const result = await run({ id: options.providerPreference }, options.providerPreference, () => undefined, new AbortController().signal)
    return { result, provider: options.providerPreference, modelId: 'modelo', usage: { inputTokens: 10, outputTokens: 5 }, keySource: 'platform' }
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.configured = new Set(['anthropic', 'openai'])
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})
afterEach(() => {
  vi.restoreAllMocks()
  if (saved === undefined) delete process.env.LAB_SECOND_READER
  else process.env.LAB_SECOND_READER = saved
})

describe('lector con modelo', () => {
  it('si el proveedor falla (sin saldo), el informe no sale a otro proveedor y no se registra contenido', async () => {
    providerAnswers({ anthropic: new Error('credit balance too low: Hemoglobina 13,5'), openai: { rows: [{ analyte: 'Glucosa', printedValue: '92', unit: null, referenceRange: null, line: 1 }] } })
    const read = await readTextWithModel(scope, ['Paciente omitido', 'Glucosa\t92\tmg/dL'])
    expect(read).toBeNull()
    expect(mocks.runWithLlmFallback.mock.calls.map((call) => (call[0] as { providerPreference: string }).providerPreference)).toEqual(['anthropic'])
    expect(JSON.stringify((console.warn as unknown as { mock: { calls: unknown[] } }).mock.calls)).not.toContain('Hemoglobina')
    expect(mocks.recordUsage).not.toHaveBeenCalled()
  })

  it('cuando responde, queda registrado el consumo con el proveedor', async () => {
    providerAnswers({ anthropic: { rows: [{ analyte: 'Glucosa', printedValue: '92', unit: null, referenceRange: null, line: 1 }] } })
    const read = await readTextWithModel(scope, ['Paciente omitido', 'Glucosa\t92\tmg/dL'])
    expect(read).toMatchObject({ provider: 'anthropic', result: [{ analyte: 'Glucosa', printedValue: '92' }] })
    expect(mocks.recordUsage).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'org-1', studyId: 'study-1', provider: 'anthropic', kind: 'clinical_extraction' }))
  })

  it('al modelo le llegan los renglones numerados, con las columnas marcadas y sin pasarse de largo', async () => {
    providerAnswers({ anthropic: { rows: [] } })
    await readTextWithModel(scope, ['Hemograma', `Hemoglobina\t13,5\tg/dL${'x'.repeat(500)}`])
    const prompt = String(mocks.generateObject.mock.calls[0]![0].prompt)
    expect(prompt.split('\n')[0]).toBe('0| Hemograma')
    expect(prompt.split('\n')[1]!.startsWith('1| Hemoglobina | 13,5 | g/dL')).toBe(true)
    expect(prompt.split('\n')[1]!.length).toBeLessThanOrEqual(304)
  })

  it('sin el proveedor configurado o con el proveedor caído devuelve null, aunque haya otros con clave', async () => {
    mocks.configured = new Set(['openai', 'google'])
    expect(await readTextWithModel(scope, ['Glucosa 92'])).toBeNull()
    expect(mocks.runWithLlmFallback).not.toHaveBeenCalled()
    mocks.configured = new Set(['anthropic', 'openai', 'google'])
    providerAnswers({ anthropic: new Error('x'), openai: { lines: [], rows: [] }, google: { lines: [], rows: [] } })
    expect(await readImagesWithModel(scope, [image])).toBeNull()
    expect(mocks.runWithLlmFallback).toHaveBeenCalledTimes(1)
  })

  it('la lectura de control va al mismo proveedor, con otro propósito (otro modelo) y su propia consigna', async () => {
    mocks.configured = new Set(['anthropic', 'openai', 'google'])
    providerAnswers({ anthropic: { lines: [], rows: [] }, openai: { lines: [], rows: [] }, google: { lines: ['a'], rows: [] } })
    expect((await readImagesWithModel(scope, [image]))?.provider).toBe('anthropic')
    expect((await readImagesWithModel(scope, [image], { control: true }))?.provider).toBe('anthropic')
    expect(mocks.runWithLlmFallback.mock.calls.map((call) => (call[0] as { purpose: string }).purpose)).toEqual(['lab-read', 'lab-read-control'])
    const [main, control] = mocks.generateObject.mock.calls.map((call) => call[0] as { instructions: string; messages: Array<{ content: Array<{ type: string; mediaType?: string }> }> })
    expect(main!.instructions).not.toContain('lectura de control')
    expect(control!.instructions).toContain('lectura de control')
    expect(main!.messages[0]!.content.filter((part) => part.type === 'image').map((part) => part.mediaType)).toEqual(['image/jpeg'])
  })

  it('LAB_SECOND_READER=off apaga la segunda lectura', () => {
    delete process.env.LAB_SECOND_READER
    expect(secondReaderEnabled()).toBe(true)
    process.env.LAB_SECOND_READER = 'off'
    expect(secondReaderEnabled()).toBe(false)
  })
})
