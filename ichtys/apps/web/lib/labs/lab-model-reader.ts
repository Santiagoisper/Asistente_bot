import type { ImageReading, ReaderRow } from '@ichtys/clinical'
import { getOrgLlmApiKeys, recordUsage } from '@ichtys/db'
import { isProviderConfigured, runWithLlmFallback, type LlmProviderId } from '@ichtys/llm'
import { generateObject } from 'ai'
import { z } from 'zod'

/**
 * Lectura de informes de laboratorio con un modelo. Este archivo solo pide la
 * lectura: nada de lo que devuelve se acepta sin la comprobación de
 * `@ichtys/clinical` (lab-readings). Al modelo nunca le llega el encabezado
 * con nombre o documento: en PDF se tapa antes; en imagen se recorta en el
 * navegador.
 */

/** Proveedores que leen bien cifras, en texto y en imagen. */
const READER_CHAIN: readonly LlmProviderId[] = ['anthropic', 'openai', 'google']
const READER_TIMEOUT_MS = 50_000
const MAX_TEXT_LINES = 1_500
const MAX_LINE_CHARS = 300

export function secondReaderEnabled(): boolean {
  return process.env.LAB_SECOND_READER !== 'off'
}

const rowSchema = z.object({
  analyte: z.string(),
  printedValue: z.string(),
  unit: z.string().nullable(),
  referenceRange: z.string().nullable(),
  line: z.number().int(),
})
const textSchema = z.object({ rows: z.array(rowSchema) })
const imageSchema = z.object({ lines: z.array(z.string()), rows: z.array(rowSchema) })

const ROW_RULES = `Cada fila:
- analyte: el nombre del analito como está escrito. Si el renglón dice "Resultado" o "Valor hallado", el nombre es el título que está más arriba.
- printedValue: el valor EXACTAMENTE como está impreso, carácter por carácter: los mismos puntos, comas y ceros. No conviertas, no redondees, no le agregues la unidad.
- unit: la unidad como está impresa, o null.
- referenceRange: el valor de referencia impreso en ese mismo renglón, o null.
- line: el número del renglón donde está el valor.
No son resultados: valores de referencia, intervalos, límites por edad o sexo, fechas, horas, números de protocolo, páginas, direcciones, teléfonos ni matrículas.
Si un renglón trae dos resultados del mismo analito en unidades distintas, devolvé dos filas.
Si no hay resultados, devolvé una lista vacía. No inventes nada.`

const TEXT_INSTRUCTIONS = `Sos un lector de informes de laboratorio clínico. Recibís el texto de un informe, un renglón por línea, con su número adelante ("12| ..."). Las columnas están separadas por " | ".
Devolvé una fila por cada resultado informado.
${ROW_RULES}`

const IMAGE_INSTRUCTIONS = `Sos un lector de informes de laboratorio clínico. Recibís una o más imágenes de un informe (foto o escaneo), en orden.
1) lines: transcribí todo el texto visible, renglón por renglón, de arriba hacia abajo, tal cual está impreso. Un renglón de la tabla es un elemento. No corrijas ni completes. Si un carácter no se lee, poné "?".
2) rows: una fila por cada resultado informado. "line" es la posición, contando desde 0, del elemento de "lines" donde está el valor.
Si la imagen muestra datos personales (nombre, documento, obra social), no los transcribas: escribí "[omitido]" en su lugar.
${ROW_RULES}`

/** Lectura de control: cambia el recorrido para no repetir el mismo error si le toca el mismo modelo. */
const IMAGE_CONTROL_INSTRUCTIONS = `${IMAGE_INSTRUCTIONS}
Esta es una lectura de control. Antes de responder, recorré la columna de valores de abajo hacia arriba y verificá cada dígito contra la imagen.`

export interface ReaderScope {
  orgId: string
  studyId: string
}

export interface ReaderResult<T> {
  result: T
  provider: LlmProviderId
}

type Call<T> = (model: Parameters<Parameters<typeof runWithLlmFallback>[1]>[0], signal: AbortSignal) => Promise<{ object: T; usage?: { inputTokens?: number; outputTokens?: number } }>

/** Prueba los proveedores en orden hasta que uno responda. null si ninguno pudo. */
async function runReader<T>(scope: ReaderScope, order: readonly LlmProviderId[], call: Call<T>): Promise<ReaderResult<T> | null> {
  const orgApiKeys = await getOrgLlmApiKeys(scope.orgId).catch(() => null)
  for (const provider of order) {
    if (!isProviderConfigured(provider, orgApiKeys)) continue
    try {
      const run = await runWithLlmFallback({ purpose: 'lab-read', providerPreference: provider, orgApiKeys }, async (model, _provider, reportUsage, signal) => {
        const response = await call(model, AbortSignal.any([signal, AbortSignal.timeout(READER_TIMEOUT_MS)]))
        reportUsage({ inputTokens: response.usage?.inputTokens ?? 0, outputTokens: response.usage?.outputTokens ?? 0 })
        return response.object
      })
      await recordUsage({
        orgId: scope.orgId,
        studyId: scope.studyId,
        userId: null,
        kind: 'clinical_extraction',
        provider: run.provider,
        model: run.modelId,
        inputTokens: run.usage.inputTokens,
        outputTokens: run.usage.outputTokens,
        keySource: run.keySource === 'none' ? 'platform' : run.keySource,
      }).catch(() => undefined)
      return { result: run.result, provider: run.provider }
    } catch (err) {
      // Sin saldo, sin clave o sin respuesta: se prueba el siguiente. Nunca se registra contenido.
      console.warn('[labs/reader] provider failed', { provider, name: err instanceof Error ? err.name : 'unknown' })
    }
  }
  return null
}

/** Segunda lectura de un PDF con texto. `lines` es la transcripción ya sin encabezado. */
export async function readTextWithModel(scope: ReaderScope, lines: readonly string[]): Promise<ReaderResult<ReaderRow[]> | null> {
  const numbered = lines
    .slice(0, MAX_TEXT_LINES)
    .map((line, index) => `${index}| ${line.replace(/\t/g, ' | ').slice(0, MAX_LINE_CHARS)}`)
    .join('\n')
  const read = await runReader(scope, READER_CHAIN, (model, signal) =>
    generateObject({
      model,
      abortSignal: signal,
      schema: textSchema,
      providerOptions: { anthropic: { structuredOutputMode: 'jsonTool' } },
      temperature: 0,
      instructions: TEXT_INSTRUCTIONS,
      prompt: numbered,
      maxOutputTokens: 12_000,
    }),
  )
  return read ? { result: read.result.rows, provider: read.provider } : null
}

export interface LabImage {
  mime: 'image/jpeg' | 'image/png' | 'image/webp'
  data: Uint8Array
}

/**
 * Lee las imágenes recortadas de un informe. La lectura de control recorre los
 * proveedores en orden inverso, para que las dos lecturas vengan de modelos
 * distintos siempre que haya más de uno disponible.
 */
export async function readImagesWithModel(
  scope: ReaderScope,
  images: readonly LabImage[],
  options: { control?: boolean } = {},
): Promise<ReaderResult<ImageReading> | null> {
  const order = options.control ? [...READER_CHAIN].reverse() : READER_CHAIN
  return runReader(scope, order, (model, signal) =>
    generateObject({
      model,
      abortSignal: signal,
      schema: imageSchema,
      providerOptions: { anthropic: { structuredOutputMode: 'jsonTool' } },
      temperature: 0,
      instructions: options.control ? IMAGE_CONTROL_INSTRUCTIONS : IMAGE_INSTRUCTIONS,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: `Informe de laboratorio: ${images.length} ${images.length === 1 ? 'imagen' : 'imágenes'}.` },
            ...images.map((image) => ({ type: 'image' as const, image: image.data, mediaType: image.mime })),
          ],
        },
      ],
      maxOutputTokens: 16_000,
    }),
  )
}
