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

  // Pasada 1 testpilot: statusCode != 200 del SDK (sin throw) tambien debe caer
  // al fallback legado — branch distinto del catch interno de readPrivateBlob.
  it('si el SDK responde status != 200 sin lanzar, cae al fallback legado', async () => {
    getMock.mockResolvedValue({ statusCode: 404, stream: null, blob: { size: 0 } })
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(streamOf('LEGADO-404'), { status: 200, headers: { 'content-length': '11' } }),
    )
    vi.stubGlobal('fetch', fetchSpy)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const result = await openStoredBlob('https://store.blob.vercel-storage.com/no-hallado.pdf')

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(await readAll(result.stream)).toBe('LEGADO-404')
  })

  // Pasada 1 testpilot: camino file:// del dev local — unico branch sin test.
  it('lee blobs file:// directo del filesystem local sin pasar por el SDK', async () => {
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = await mkdtemp(join(tmpdir(), 'ichtys-blob-read-'))
    try {
      const filePath = join(dir, 'dev.pdf')
      await writeFile(filePath, 'PDF-LOCAL-DEV')
      const fetchSpy = vi.fn()
      vi.stubGlobal('fetch', fetchSpy)

      const result = await openStoredBlob(`file://${filePath}`)

      expect(getMock).not.toHaveBeenCalled()
      expect(fetchSpy).not.toHaveBeenCalled()
      expect(result.size).toBe(13)
      expect(await readAll(result.stream)).toBe('PDF-LOCAL-DEV')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
