'use client'

import { useRouter } from 'next/navigation'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type DocumentVersionStatus = 'pending' | 'processing' | 'ready' | 'error'

export type DocumentStatusItem = {
  documentId: string
  documentName: string
  documentType: string
  latestVersionId: string | null
  status: DocumentVersionStatus
  pageCount: number | null
  errorMessage: string | null
  createdAt: string
}

const POLL_INTERVAL_MS = 4_000
/** Refresco del contador de progreso (animación fluida). */
const PROGRESS_TICK_MS = 700

const INGESTION_ERROR_LABELS: Record<string, string> = {
  embedding_config_missing:
    'Falta GROQ_API_KEY (o OPENAI_API_KEY) en apps/web/.env.local. Reiniciá pnpm dev y reprocesá.',
  embedding_provider_error:
    'El proveedor de embeddings rechazó la solicitud. Revisá la API key y el saldo.',
  embedding_rate_limited: 'OpenAI limitó la tasa de requests. Esperá unos minutos y reprocesá.',
  embedding_dimension_mismatch: 'Error interno de dimensiones de embedding. Contactá soporte.',
  embedding_internal_error: 'Error interno al indexar el documento.',
  pdf_text_extraction_failed: 'No se pudo extraer texto del PDF.',
  pdf_contains_no_extractable_text: 'El PDF no tiene texto seleccionable (puede ser escaneado).',
  blob_download_failed: 'No se pudo leer el archivo almacenado. Volvé a subirlo.',
  stuck_timeout: 'El procesamiento quedó colgado. Usá Reprocesar.',
  ingestion_internal_error: 'Error interno de ingesta.',
}

function formatIngestionError(code: string | null): string | null {
  if (!code) return null
  return INGESTION_ERROR_LABELS[code] ?? code
}

/** True si algún item sigue en vuelo (necesita polling). */
function needsPolling(items: DocumentStatusItem[]): boolean {
  return items.some((i) => i.status === 'processing' || i.status === 'pending')
}

/**
 * Progreso estimado (0-100) en función del tiempo transcurrido procesando.
 *
 * No es un porcentaje "real" reportado por el backend (la ingesta corre en
 * segundo plano sin canal de progreso incremental); es una curva asintótica
 * calibrada al tiempo típico de un protocolo. Sube rápido al principio y se
 * desacelera acercándose al 96%, donde espera a que el estado pase a 'ready'
 * (momento en que la UI salta a 100%). Da feedback honesto de "sigue trabajando"
 * sin mentir diciendo que terminó.
 */
function estimateProgress(elapsedMs: number): number {
  const tau = 30_000 // constante de tiempo (~30s)
  const raw = 96 * (1 - Math.exp(-elapsedMs / tau))
  return Math.min(96, Math.max(4, Math.round(raw)))
}

/** Etiqueta de etapa aproximada según el progreso. */
function stageLabel(pct: number): string {
  if (pct < 15) return 'Subiendo y parseando el PDF...'
  if (pct < 40) return 'Extrayendo y dividiendo el texto...'
  if (pct < 68) return 'Indexando fragmentos (embeddings)...'
  if (pct < 92) return 'Extrayendo spec con IA...'
  return 'Finalizando...'
}

interface DocumentsStatusListProps {
  items: DocumentStatusItem[]
  studyId: string
}

export function DocumentsStatusList({ items: initialItems, studyId }: DocumentsStatusListProps) {
  const router = useRouter()
  const [items, setItems] = useState<DocumentStatusItem[]>(initialItems)
  const [busyVersionId, setBusyVersionId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [pollError, setPollError] = useState<string | null>(null)
  const pollFailuresRef = useRef(0)
  const [now, setNow] = useState<number>(() => Date.now())
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const itemsRef = useRef(items)
  itemsRef.current = items
  // versionId → timestamp (reloj del cliente) en que lo vimos procesando por
  // primera vez. Resiliente a reprocesos: se resetea al volver a 'processing'.
  const startTimesRef = useRef<Map<string, number>>(new Map())

  // Sincronizar con cambios de prop (e.g. después de router.refresh()).
  useEffect(() => {
    setItems(initialItems)
  }, [initialItems])

  // Registrar/limpiar el inicio de procesamiento por versión.
  useEffect(() => {
    const map = startTimesRef.current
    const activeIds = new Set<string>()
    for (const item of items) {
      if (!item.latestVersionId) continue
      if (item.status === 'processing' || item.status === 'pending') {
        activeIds.add(item.latestVersionId)
        if (!map.has(item.latestVersionId)) map.set(item.latestVersionId, Date.now())
      }
    }
    // Limpiar entradas de versiones que ya terminaron.
    for (const key of map.keys()) {
      if (!activeIds.has(key)) map.delete(key)
    }
  }, [items])

  // Tick para animar la barra de progreso mientras hay procesamiento activo.
  useEffect(() => {
    if (needsPolling(items)) {
      if (!tickRef.current) {
        tickRef.current = setInterval(() => setNow(Date.now()), PROGRESS_TICK_MS)
      }
    } else if (tickRef.current) {
      clearInterval(tickRef.current)
      tickRef.current = null
    }
    return () => {
      if (tickRef.current) {
        clearInterval(tickRef.current)
        tickRef.current = null
      }
    }
  }, [items])

  const fetchDocuments = useCallback(async () => {
    try {
      const res = await fetch(`/api/studies/${studyId}/documents`, { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const fresh = (await res.json()) as DocumentStatusItem[]
      const wasPolling = needsPolling(itemsRef.current)
      setItems(fresh)
      pollFailuresRef.current = 0
      setPollError(null)
      // Refrescar server components (spec, layout) cuando termina la ingesta.
      if (wasPolling && !needsPolling(fresh)) {
        router.refresh()
      }
    } catch {
      // Un fallo suelto de red no se muestra (el polling reintenta solo);
      // recién avisamos si se repite, para no alarmar por un blip.
      pollFailuresRef.current += 1
      if (pollFailuresRef.current >= 2) {
        setPollError('No se pudo actualizar el estado de los documentos. Reintentando…')
      }
    }
  }, [studyId, router])

  // Iniciar/detener polling según el estado actual de los items.
  useEffect(() => {
    if (needsPolling(items)) {
      if (!pollingRef.current) {
        pollingRef.current = setInterval(() => {
          void fetchDocuments()
        }, POLL_INTERVAL_MS)
      }
    } else {
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
        pollingRef.current = null
      }
    }

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
        pollingRef.current = null
      }
    }
  }, [items, fetchDocuments])

  const sortedItems = useMemo(
    () =>
      [...items].sort((a, b) => {
        const dateA = new Date(a.createdAt).getTime()
        const dateB = new Date(b.createdAt).getTime()
        return dateB - dateA
      }),
    [items],
  )

  async function triggerReprocess(item: DocumentStatusItem): Promise<void> {
    if (!item.latestVersionId) return
    setBusyVersionId(item.latestVersionId)
    setActionError(null)

    // Optimistic update — mostrar 'processing' de inmediato.
    setItems((prev) =>
      prev.map((i) =>
        i.latestVersionId === item.latestVersionId ? { ...i, status: 'processing' } : i,
      ),
    )

    try {
      const response = await fetch('/api/ingestion/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentVersionId: item.latestVersionId }),
      })
      if (!response.ok) {
        setActionError('No se pudo iniciar el reprocesamiento.')
        // Revert optimistic update.
        setItems((prev) =>
          prev.map((i) =>
            i.latestVersionId === item.latestVersionId ? { ...i, status: item.status } : i,
          ),
        )
      }
      // Si fue OK, el polling va a detectar el cambio a 'ready' automáticamente.
    } catch {
      setActionError('Error de red al iniciar reprocesamiento.')
      setItems((prev) =>
        prev.map((i) =>
          i.latestVersionId === item.latestVersionId ? { ...i, status: item.status } : i,
        ),
      )
    } finally {
      setBusyVersionId(null)
    }
  }

  return (
    <div className="space-y-3 rounded-md border border-alphi-border bg-white p-4">
      <div>
        <h2 className="text-sm font-semibold text-alphi-navy">Estado de documentos del estudio</h2>
        <p className="text-xs text-alphi-muted">Mostramos la última versión de cada documento cargado.</p>
      </div>

      {actionError ? (
        <p className="rounded-md border border-alphi-rose/30 bg-alphi-rose/10 px-3 py-2 text-xs text-alphi-rose">{actionError}</p>
      ) : null}
      {pollError ? (
        <p className="rounded-md border border-alphi-amber/30 bg-alphi-amber/10 px-3 py-2 text-xs text-alphi-amber">{pollError}</p>
      ) : null}

      {sortedItems.length === 0 ? (
        <p className="text-sm text-alphi-muted">Todavía no hay documentos cargados en este estudio.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-[640px] w-full table-fixed text-left text-xs">
            <colgroup>
              <col className="w-[20%]" />
              <col className="w-[12%]" />
              <col className="w-[16%]" />
              <col className="w-[8%]" />
              <col className="w-[22%]" />
              <col className="w-[22%]" />
            </colgroup>
            <thead className="bg-alphi-slate text-alphi-muted">
              <tr>
                <th className="px-3 py-2">Documento</th>
                <th className="px-3 py-2">Tipo</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2">Páginas</th>
                <th className="px-3 py-2">Error</th>
                <th className="px-3 py-2">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-alphi-border">
              {sortedItems.map((item) => (
                <tr key={item.documentId}>
                  <td className="px-3 py-2 align-top text-alphi-navy break-words">{item.documentName}</td>
                  <td className="px-3 py-2 align-top text-alphi-muted">{item.documentType}</td>
                  <td className="px-3 py-2 align-top">
                    {item.status === 'processing' || item.status === 'pending' ? (
                      <ProgressIndicator
                        startedAt={
                          item.latestVersionId
                            ? startTimesRef.current.get(item.latestVersionId) ?? now
                            : now
                        }
                        now={now}
                      />
                    ) : (
                      <StatusPill status={item.status} />
                    )}
                  </td>
                  <td className="px-3 py-2 align-top text-alphi-muted">{item.pageCount ?? '—'}</td>
                  <td className="px-3 py-2 align-top text-alphi-muted">
                    {item.errorMessage ? (
                      <span className="break-words">{formatIngestionError(item.errorMessage)}</span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {item.latestVersionId ? (
                        <>
                          <a
                            href={`/api/document-versions/${item.latestVersionId}/download?inline=1`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="rounded-md border border-alphi-teal/40 px-2 py-1 text-xs font-medium text-alphi-teal hover:bg-alphi-teal/10"
                          >
                            Ver
                          </a>
                          <a
                            href={`/api/document-versions/${item.latestVersionId}/download`}
                            className="rounded-md border border-alphi-border px-2 py-1 text-xs font-medium text-alphi-muted hover:bg-alphi-slate"
                          >
                            Descargar
                          </a>
                        </>
                      ) : null}
                      <button
                        type="button"
                        disabled={
                          !item.latestVersionId ||
                          busyVersionId === item.latestVersionId
                        }
                        onClick={() => {
                          void triggerReprocess(item)
                        }}
                        className="rounded-md border border-alphi-border px-2 py-1 text-xs font-medium text-alphi-muted hover:bg-alphi-slate disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {busyVersionId === item.latestVersionId
                          ? 'Iniciando...'
                          : item.status === 'processing'
                            ? 'Forzar reprocesar'
                            : 'Reprocesar'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function ProgressIndicator({ startedAt, now }: { startedAt: number; now: number }) {
  const elapsedMs = Math.max(0, now - startedAt)
  const pct = estimateProgress(elapsedMs)
  const seconds = Math.floor(elapsedMs / 1000)

  return (
    <div className="min-w-[150px] space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-alphi-teal">{pct}%</span>
        <span className="font-mono text-[10px] text-alphi-muted">{seconds}s</span>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-alphi-slate"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full rounded-full bg-alphi-teal transition-all duration-700 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-[10px] leading-tight text-alphi-muted">{stageLabel(pct)}</p>
    </div>
  )
}

const STATUS_LABEL: Record<DocumentVersionStatus, string> = {
  ready: 'Listo',
  processing: 'Procesando',
  error: 'Error',
  pending: 'Pendiente',
}

function StatusPill({ status }: { status: DocumentVersionStatus }) {
  const className =
    status === 'ready'
      ? 'border-alphi-sage/30 bg-alphi-sage/10 text-alphi-sage'
      : status === 'processing'
        ? 'border-alphi-teal/30 bg-alphi-teal/10 text-alphi-teal'
        : status === 'error'
          ? 'border-alphi-rose/30 bg-alphi-rose/10 text-alphi-rose'
          : 'border-alphi-border bg-alphi-slate text-alphi-muted'

  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${className}`}>
      {status === 'processing' ? (
        <span className="flex items-center gap-1">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-alphi-teal" />
          {STATUS_LABEL[status]}
        </span>
      ) : (
        STATUS_LABEL[status]
      )}
    </span>
  )
}
