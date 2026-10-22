import { describe, expect, it } from 'vitest'
import {
  deriveIngestionStage,
  describeIngestionErrorMessage,
  INGESTION_STAGE_LABELS,
  INGESTION_STAGE_ORDER,
  POLL_INTERVAL_MS,
  POLL_MAX_DURATION_MS,
  shouldStopPolling,
} from '../ingestion-stage'

describe('deriveIngestionStage — etapa real de la ingesta derivada de la DB', () => {
  it('pending → queued (aún no arrancó: blob subido, ingestion en cola)', () => {
    expect(
      deriveIngestionStage({ versionStatus: 'pending', isProtocol: true, pagesCount: 0, chunksTotal: 0, chunksEmbedded: 0 }),
    ).toBe('queued')
  })

  it('processing sin páginas aún → reading (descargando/leyendo el PDF)', () => {
    expect(
      deriveIngestionStage({ versionStatus: 'processing', isProtocol: true, pagesCount: 0, chunksTotal: 0, chunksEmbedded: 0 }),
    ).toBe('reading')
  })

  it('processing con páginas y chunks sin embeber completo → indexing', () => {
    expect(
      deriveIngestionStage({ versionStatus: 'processing', isProtocol: true, pagesCount: 40, chunksTotal: 120, chunksEmbedded: 30 }),
    ).toBe('indexing')
  })

  it('processing con embeddings completos y protocolo → extracting (esperando el SoA)', () => {
    expect(
      deriveIngestionStage({ versionStatus: 'processing', isProtocol: true, pagesCount: 40, chunksTotal: 120, chunksEmbedded: 120 }),
    ).toBe('extracting')
  })

  it('processing con embeddings completos y NO protocolo → indexing (no hay spec que esperar)', () => {
    expect(
      deriveIngestionStage({ versionStatus: 'processing', isProtocol: false, pagesCount: 40, chunksTotal: 120, chunksEmbedded: 120 }),
    ).toBe('indexing')
  })

  it('ready → ready', () => {
    expect(
      deriveIngestionStage({ versionStatus: 'ready', isProtocol: true, pagesCount: 40, chunksTotal: 120, chunksEmbedded: 120 }),
    ).toBe('ready')
  })

  it('error → error', () => {
    expect(
      deriveIngestionStage({ versionStatus: 'error', isProtocol: true, pagesCount: 0, chunksTotal: 0, chunksEmbedded: 0 }),
    ).toBe('error')
  })

  it('edge: páginas insertadas pero sin chunks aún → reading (misma transacción, breve)', () => {
    expect(
      deriveIngestionStage({ versionStatus: 'processing', isProtocol: true, pagesCount: 40, chunksTotal: 0, chunksEmbedded: 0 }),
    ).toBe('reading')
  })
})

describe('etiquetas y orden para la UI', () => {
  it('todas las etapas tienen etiqueta en español con progresión clara', () => {
    expect(INGESTION_STAGE_LABELS.queued).toMatch(/cola/i)
    expect(INGESTION_STAGE_LABELS.reading).toMatch(/[Ll]eyendo/)
    expect(INGESTION_STAGE_LABELS.indexing).toMatch(/[Ii]ndexando/)
    expect(INGESTION_STAGE_LABELS.extracting).toMatch(/[Ee]xtrayendo/)
    expect(INGESTION_STAGE_LABELS.ready).toMatch(/[Ll]isto/)
    expect(INGESTION_STAGE_LABELS.error).toMatch(/[Ee]rror/)
  })

  it('el orden de etapas es la progresión real del pipeline', () => {
    expect(INGESTION_STAGE_ORDER).toEqual(['queued', 'reading', 'indexing', 'extracting', 'ready'])
  })

  it('shouldStopPolling corta solo en estados terminales', () => {
    expect(shouldStopPolling('ready')).toBe(true)
    expect(shouldStopPolling('error')).toBe(true)
    expect(shouldStopPolling('queued')).toBe(false)
    expect(shouldStopPolling('reading')).toBe(false)
    expect(shouldStopPolling('indexing')).toBe(false)
    expect(shouldStopPolling('extracting')).toBe(false)
  })

  it('parámetros del polling en rangos sanos (2-4 s de intervalo, tope 10-20 min)', () => {
    expect(POLL_INTERVAL_MS).toBeGreaterThanOrEqual(2000)
    expect(POLL_INTERVAL_MS).toBeLessThanOrEqual(4000)
    expect(POLL_MAX_DURATION_MS).toBeGreaterThanOrEqual(10 * 60 * 1000)
    expect(POLL_MAX_DURATION_MS).toBeLessThanOrEqual(20 * 60 * 1000)
  })
})

describe('describeIngestionErrorMessage — códigos internos → mensaje claro en español', () => {
  it('mapea cada código conocido a texto útil', () => {
    expect(describeIngestionErrorMessage('pdf_contains_no_extractable_text')).toMatch(/escaneado|texto/i)
    expect(describeIngestionErrorMessage('pdf_text_extraction_failed')).toMatch(/leer el texto|PDF/i)
    expect(describeIngestionErrorMessage('blob_download_failed')).toMatch(/descargar|archivo/i)
    expect(describeIngestionErrorMessage('embedding_rate_limited')).toMatch(/saturad|minutos/i)
    expect(describeIngestionErrorMessage('ingestion_internal_error')).toMatch(/[Ee]rror interno/)
  })

  it('código desconocido o null → mensaje genérico, nunca el código crudo', () => {
    expect(describeIngestionErrorMessage('codigo_nuevo_del_futuro')).not.toContain('codigo_nuevo_del_futuro')
    expect(describeIngestionErrorMessage('codigo_nuevo_del_futuro')).toMatch(/procesar|error/i)
    expect(describeIngestionErrorMessage(null)).toMatch(/procesar|error/i)
    expect(describeIngestionErrorMessage('random-uuid-like-abc123')).not.toMatch(/[a-z]+_[a-z]+/)
  })
})
