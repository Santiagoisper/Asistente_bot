import { afterEach, describe, expect, it, vi } from 'vitest'

const putMock = vi.fn()
vi.mock('@vercel/blob', () => ({ put: (...args: unknown[]) => putMock(...args) }))

import { putPrivateDocumentPdf } from '../blob-storage'

afterEach(() => {
  putMock.mockReset()
  vi.unstubAllEnvs()
})

describe('putPrivateDocumentPdf (SEC-01)', () => {
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
})
