import { afterEach, describe, expect, it, vi } from 'vitest'

const getMock = vi.fn()
vi.mock('@vercel/blob', () => ({ get: (...args: unknown[]) => getMock(...args) }))

import { openStoredBlob, StoredBlobReadError } from '../blob-read'

function streamOf(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text))
      controller.close()
    },
  })
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader()
  let out = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return out
    out += new TextDecoder().decode(value)
  }
}

afterEach(() => {
  getMock.mockReset()
  vi.unstubAllGlobals()
})

describe('openStoredBlob (SEC-01)', () => {
  it('lee objetos nuevos con acceso privado autenticado y sin fetch directo', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    getMock.mockResolvedValue({
      statusCode: 200,
      stream: streamOf('PDF-SINTETICO'),
      blob: { size: 13 },
    })

    const result = await openStoredBlob('https://store.private.blob.vercel-storage.com/a.pdf')

    expect(getMock).toHaveBeenCalledWith('https://store.private.blob.vercel-storage.com/a.pdf', {
      access: 'private',
    })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(result.size).toBe(13)
    expect(await readAll(result.stream)).toBe('PDF-SINTETICO')
  })

  it('usa fetch solo como fallback para objetos legados publicos', async () => {
    getMock.mockResolvedValue(null)
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(streamOf('LEGADO'), { status: 200, headers: { 'content-length': '6' } }),
    )
    vi.stubGlobal('fetch', fetchSpy)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const result = await openStoredBlob('https://store.public.blob.vercel-storage.com/old.pdf')

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(result.size).toBe(6)
    expect(await readAll(result.stream)).toBe('LEGADO')
  })

  it('si el SDK falla y el fallback tambien, lanza un error sin detalles internos', async () => {
    getMock.mockRejectedValue(new Error('token=secreto-interno'))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 403 })))
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const promise = openStoredBlob('https://store.blob.vercel-storage.com/x.pdf')

    await expect(promise).rejects.toBeInstanceOf(StoredBlobReadError)
    await expect(promise).rejects.not.toThrow(/secreto/)
  })
})
