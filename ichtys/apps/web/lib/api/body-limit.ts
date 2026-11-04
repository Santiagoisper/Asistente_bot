import { MAX_JSON_BODY_BYTES } from './limits'

/** El cuerpo del request excede el tope de bytes (ver readJsonBody). */
export class JsonBodyTooLargeError extends Error {
  constructor() {
    super('Request body exceeds the size limit')
    this.name = 'JsonBodyTooLargeError'
  }
}

/**
 * Lee y parsea el cuerpo JSON con un tope de bytes ANTES de parsear.
 *
 * GHSA-mrhx-c7xc-m3w5 / H7 (vuelta 2 del delta zod): sin esta barrera un
 * cuerpo gigante llega entero al JSON.parse y al safeParse del esquema.
 * Corte en dos capas: si Content-Length ya anuncia más del tope se rechaza
 * sin leer un byte; si el stream excede el tope a mitad de lectura se
 * cancela la conexión y se rechaza.
 *
 * Errores: JsonBodyTooLargeError (→ 413 en la ruta), SyntaxError si el
 * cuerpo no es JSON válido (→ 400, mismo comportamiento que req.json()).
 * `allowEmpty` acepta cuerpo ausente/vacío como {} — lo usa labs/confirm,
 * cuyo POST sin labs confirma la revisión tal como se extrajo.
 */
export async function readJsonBody(
  req: Request,
  options: { limitBytes?: number; allowEmpty?: boolean } = {},
): Promise<unknown> {
  const limit = options.limitBytes ?? MAX_JSON_BODY_BYTES

  const declared = Number(req.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > limit) {
    throw new JsonBodyTooLargeError()
  }

  const reader = req.body?.getReader()
  if (!reader) {
    if (options.allowEmpty) return {}
    throw new SyntaxError('Request has no body')
  }

  const decoder = new TextDecoder()
  let received = 0
  let text = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    received += value.byteLength
    if (received > limit) {
      await reader.cancel()
      throw new JsonBodyTooLargeError()
    }
    text += decoder.decode(value, { stream: true })
  }
  text += decoder.decode()

  if (options.allowEmpty && text.trim() === '') return {}
  try {
    return JSON.parse(text)
  } catch {
    throw new SyntaxError('Invalid JSON body')
  }
}
