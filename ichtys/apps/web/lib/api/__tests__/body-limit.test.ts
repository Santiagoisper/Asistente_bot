/**
 * readJsonBody — tope de bytes del cuerpo ANTES de parsear
 * (vuelta 2 del delta zod, H7; GHSA-mrhx-c7xc-m3w5).
 */
import { describe, expect, it } from 'vitest'
import { JsonBodyTooLargeError, readJsonBody } from '../body-limit'
import { MAX_JSON_BODY_BYTES } from '../limits'

const URL_ = 'http://localhost/api/test'

function streamFromChunks(chunks: string[], onCancel?: () => void): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
    cancel() {
      onCancel?.()
    },
  })
}

describe('readJsonBody', () => {
  it('Content-Length por encima del tope → 413 sin leer el cuerpo', async () => {
    const req = new Request(URL_, {
      method: 'POST',
      headers: { 'content-length': String(MAX_JSON_BODY_BYTES + 1) },
    })
    await expect(readJsonBody(req)).rejects.toBeInstanceOf(JsonBodyTooLargeError)
  })

  it('stream que excede el tope a mitad de lectura → 413 y conexión cancelada', async () => {
    let cancelled = false
    const stream = streamFromChunks(
      // El chunk 2 cruza el tope a mitad de lectura; el 3 no debe leerse.
      ['{"padding":"', 'x'.repeat(MAX_JSON_BODY_BYTES), 'tail-que-no-debe-leerse'],
      () => {
        cancelled = true
      },
    )
    const req = new Request(URL_, {
      method: 'POST',
      body: stream,
      // undici exige duplex para body de stream.
      duplex: 'half',
    } as RequestInit)
    await expect(readJsonBody(req)).rejects.toBeInstanceOf(JsonBodyTooLargeError)
    // El lector se cancela apenas cruza el tope — no sigue bajando el resto.
    expect(cancelled).toBe(true)
  })

  it('cuerpo chico y válido → JSON parseado igual que req.json()', async () => {
    const req = new Request(URL_, {
      method: 'POST',
      body: JSON.stringify({ labs: [{ name: 'HbA1c', value: 8.2 }] }),
    })
    await expect(readJsonBody(req)).resolves.toEqual({ labs: [{ name: 'HbA1c', value: 8.2 }] })
  })

  it('JSON inválido → SyntaxError (la ruta lo mapea a 400)', async () => {
    const req = new Request(URL_, { method: 'POST', body: '{"no":"json sin cerrar' })
    await expect(readJsonBody(req)).rejects.toBeInstanceOf(SyntaxError)
  })

  it('allowEmpty: cuerpo ausente o vacío → {} (caso labs/confirm)', async () => {
    const sinBody = new Request(URL_, { method: 'POST' })
    await expect(readJsonBody(sinBody, { allowEmpty: true })).resolves.toEqual({})

    const vacio = new Request(URL_, { method: 'POST', body: '   ' })
    await expect(readJsonBody(vacio, { allowEmpty: true })).resolves.toEqual({})

    // Sin allowEmpty, el cuerpo ausente es error como con req.json().
    await expect(readJsonBody(sinBody)).rejects.toBeInstanceOf(SyntaxError)
  })

  it('límite custom (limitBytes): rechaza por encima del custom, acepta por debajo', async () => {
    const grande = new Request(URL_, {
      method: 'POST',
      body: JSON.stringify({ data: 'x'.repeat(1000) }),
    })
    await expect(readJsonBody(grande, { limitBytes: 100 })).rejects.toBeInstanceOf(
      JsonBodyTooLargeError,
    )

    const chico = new Request(URL_, {
      method: 'POST',
      body: JSON.stringify({ data: 'x'.repeat(50) }),
    })
    await expect(readJsonBody(chico, { limitBytes: 200 })).resolves.toEqual({
      data: 'x'.repeat(50),
    })
  })
})
