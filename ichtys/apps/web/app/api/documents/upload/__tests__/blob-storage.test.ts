import { afterEach, describe, expect, it, vi } from 'vitest'

const putMock = vi.fn()
const fsMocks = vi.hoisted(() => ({ mkdir: vi.fn(), writeFile: vi.fn() }))
vi.mock('@vercel/blob', () => ({ put: (...args: unknown[]) => putMock(...args) }))
vi.mock('node:fs/promises', () => fsMocks)

import { putPrivateDocumentPdf } from '../blob-storage'

afterEach(() => {
  putMock.mockReset()
  fsMocks.mkdir.mockReset()
  fsMocks.writeFile.mockReset()
  vi.unstubAllEnvs()
})

describe('putPrivateDocumentPdf (SEC-01)', () => {
  it.each(['production', 'test'])('falla sin token en %s sin escribir en tmpdir', async (environment) => {
    vi.stubEnv('NODE_ENV', environment)
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', '')
    const file = new File([new Uint8Array([37, 80, 68, 70])], 'sintetico.pdf', { type: 'application/pdf' })

    await expect(putPrivateDocumentPdf({ blobKey: 'k/x.pdf', file })).rejects.toThrow('blob_token_missing')
    expect(putMock).not.toHaveBeenCalled()
    expect(fsMocks.mkdir).not.toHaveBeenCalled()
    expect(fsMocks.writeFile).not.toHaveBeenCalled()
  })

  it('conserva el mock local solo en development sin token', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', '')
    const file = new File([new Uint8Array([37, 80, 68, 70])], 'sintetico.pdf', { type: 'application/pdf' })

    const stored = await putPrivateDocumentPdf({ blobKey: 'k/x.pdf', file })
    expect(stored.url).toMatch(/^file:\/\//)
    expect(fsMocks.mkdir).toHaveBeenCalledTimes(1)
    expect(fsMocks.writeFile).toHaveBeenCalledTimes(1)
    expect(putMock).not.toHaveBeenCalled()
  })

  it('sube a Vercel Blob con access private, nunca public', async () => {
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'token-sintetico')
    putMock.mockResolvedValue({ url: 'https://s.blob/x.pdf', pathname: 'k/x.pdf' })
    vi.spyOn(console, 'log').mockImplementation(() => undefined)

    const file = new File([new Uint8Array([37, 80, 68, 70])], 'sintetico.pdf', {
      type: 'application/pdf',
    })
    const stored = await putPrivateDocumentPdf({ blobKey: 'k/x.pdf', file })

    expect(putMock).toHaveBeenCalledTimes(1)
    const options = putMock.mock.calls[0]?.[2] as { access: string; allowOverwrite: boolean }
    expect(options.access).toBe('private')
    expect(options.allowOverwrite).toBe(false)
    expect(stored.pathname).toBe('k/x.pdf')
  })

  it('no escribe el error crudo del SDK cuando put falla', async () => {
    const sentinel = 'protocolo-ficticio-PHI.pdf'
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'token-sintetico')
    putMock.mockRejectedValue(new Error(`https://store.private.blob.vercel-storage.com/${sentinel}`))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const file = new File([new Uint8Array([37, 80, 68, 70])], sentinel, { type: 'application/pdf' })

    try {
      await expect(putPrivateDocumentPdf({ blobKey: 'k/x.pdf', file })).rejects.toThrow('blob_upload_failed')
      const logged = spy.mock.calls.map((args) => args.map((value) => {
        if (value instanceof Error) return `${value.message} ${value.stack ?? ''}`
        if (value && typeof value === 'object') return JSON.stringify(value)
        return String(value)
      }).join(' ')).join('\n')
      expect(logged).not.toContain(sentinel)
      expect(logged).toContain('blob_upload_failed')
    } finally {
      spy.mockRestore()
    }
  })
})
