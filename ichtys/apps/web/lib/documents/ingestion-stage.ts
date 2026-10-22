/**
 * ingestion-stage.ts — etapa REAL de la ingesta de un documento, derivada de
 * lo que el pipeline ya persistió (ver packages/ingestion/pipeline.ts).
 *
 * El pipeline no persiste una etapa explícita: inserta pages+chunks sin
 * embedding en una transacción, embebe los chunks y (solo protocolos) extrae
 * el spec SoA en paralelo, y recién al final marca la versión 'ready'.
 * Contando qué hay en la DB se deriva en qué etapa está HOY, sin tocar el
 * pipeline ni el schema:
 *
 *   pending    → queued      (blob subido; ingestion aún no arrancó)
 *   processing → reading     (sin páginas todavía: descargando/parseando PDF)
 *              → indexing    (hay chunks; embeddings incompletos o sin spec)
 *              → extracting  (embeddings completos en un protocolo: queda el SoA)
 *   ready/error → ready/error
 *
 * Si algún día se persiste la etapa exacta (propuesta a sicario), este módulo
 * es el único lugar a reemplazar.
 */

export type IngestionStageId = 'queued' | 'reading' | 'indexing' | 'extracting' | 'ready' | 'error'

export interface IngestionStageSignals {
  versionStatus: 'pending' | 'processing' | 'ready' | 'error'
  /** documentType === 'protocol' (los únicos con extracción de spec/SoA). */
  isProtocol: boolean
  pagesCount: number
  chunksTotal: number
  chunksEmbedded: number
}

export function deriveIngestionStage(signals: IngestionStageSignals): IngestionStageId {
  switch (signals.versionStatus) {
    case 'pending':
      return 'queued'
    case 'ready':
      return 'ready'
    case 'error':
      return 'error'
    case 'processing':
      if (signals.pagesCount === 0 || signals.chunksTotal === 0) return 'reading'
      if (signals.chunksEmbedded < signals.chunksTotal) return 'indexing'
      return signals.isProtocol ? 'extracting' : 'indexing'
  }
}

/** Progresión real del pipeline (sin terminales) para barras de pasos. */
export const INGESTION_STAGE_ORDER: readonly IngestionStageId[] = [
  'queued',
  'reading',
  'indexing',
  'extracting',
  'ready',
]

export const INGESTION_STAGE_LABELS: Readonly<Record<IngestionStageId, string>> = {
  queued: 'En cola para procesar',
  reading: 'Leyendo el PDF',
  indexing: 'Indexando para búsqueda',
  extracting: 'Extrayendo visitas y criterios (SoA)',
  ready: 'Listo',
  error: 'Error al procesar',
}

export function shouldStopPolling(stage: IngestionStageId): boolean {
  return stage === 'ready' || stage === 'error'
}

export const POLL_INTERVAL_MS = 2500
/** Tope del polling activo en pantalla; luego sigue en background igual. */
export const POLL_MAX_DURATION_MS = 15 * 60 * 1000

/**
 * Códigos de error internos del pipeline (IngestionErrorCode) → mensaje claro
 * para el usuario. Nunca se devuelve el código crudo: un código nuevo del
 * futuro cae en el genérico.
 */
const INGESTION_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  blob_download_failed:
    'No pudimos descargar el archivo del almacenamiento seguro. Probá subirlo de nuevo.',
  pdf_text_extraction_failed:
    'No pudimos leer el texto del PDF. Si es una imagen escaneada, exportá primero un PDF con texto.',
  pdf_contains_no_extractable_text:
    'El PDF no tiene texto extraíble (parece escaneado). Se necesita un PDF con texto real.',
  embedding_config_missing:
    'Falta configurar el servicio de indexación. Escribinos para resolverlo.',
  embedding_dimension_mismatch:
    'Error interno de indexación del documento. Escribinos para resolverlo.',
  embedding_internal_error:
    'El servicio de indexación falló. Probá reprocesar el documento.',
  embedding_provider_error:
    'El servicio de indexación falló. Probá reprocesar el documento.',
  embedding_rate_limited:
    'El servicio de indexación está saturado. Esperá unos minutos y probá de nuevo.',
  ingestion_internal_error:
    'Error interno al procesar el documento. Probá de nuevo en unos instantes.',
}

const GENERIC_INGESTION_ERROR =
  'No pudimos procesar el documento. Probá de nuevo o escribinos si sigue fallando.'

export function describeIngestionErrorMessage(rawErrorCode: string | null): string {
  if (!rawErrorCode) return GENERIC_INGESTION_ERROR
  return INGESTION_ERROR_MESSAGES[rawErrorCode] ?? GENERIC_INGESTION_ERROR
}
