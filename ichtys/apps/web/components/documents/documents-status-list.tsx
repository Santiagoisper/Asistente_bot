'use client'

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

/** True si algún item sigue en vuelo (necesita polling). */
function needsPolling(items: DocumentStatusItem[]): boolean {
  return items.some((i) => i.status === 'processing' || i.status === 'pending')
}

interface DocumentsStatusListProps {
  items: DocumentStatusItem[]
  studyId: string
}

export function DocumentsStatusList({ items: initialItems, studyId }: DocumentsStatusListProps) {
  const [items, setItems] = useState<DocumentStatusItem[]>(initialItems)
  const [busyVersionId, setBusyVersionId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Sincronizar con cambios de prop (e.g. después de router.refresh()).
  useEffect(() => {
    setItems(initialItems)
  }, [initialItems])

  const fetchDocuments = useCallback(async () => {
    try {
      const res = await fetch(`/api/studies/${studyId}/documents`, { cache: 'no-store' })
      if (!res.ok) return
      const fresh = (await res.json()) as DocumentStatusItem[]
      setItems(fresh)
    } catch {
      // silencioso — el polling reintenta en el próximo ciclo
    }
  }, [studyId])

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
    <div className="space-y-3 rounded-md border border-gray-200 bg-white p-4">
      <div>
        <h2 className="text-sm font-semibold text-gray-900">Estado de documentos del estudio</h2>
        <p className="text-xs text-gray-500">Mostramos la última versión de cada documento cargado.</p>
      </div>

      {actionError ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{actionError}</p>
      ) : null}

      {sortedItems.length === 0 ? (
        <p className="text-sm text-gray-500">Todavía no hay documentos cargados en este estudio.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="px-3 py-2">Documento</th>
                <th className="px-3 py-2">Tipo</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2">Páginas</th>
                <th className="px-3 py-2">Error</th>
                <th className="px-3 py-2">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sortedItems.map((item) => (
                <tr key={item.documentId}>
                  <td className="px-3 py-2 text-gray-900">{item.documentName}</td>
                  <td className="px-3 py-2 text-gray-700">{item.documentType}</td>
                  <td className="px-3 py-2">
                    <StatusPill status={item.status} />
                  </td>
                  <td className="px-3 py-2 text-gray-700">{item.pageCount ?? '—'}</td>
                  <td className="max-w-xs px-3 py-2 text-gray-700">
                    {item.errorMessage ? (
                      <span className="break-words">{item.errorMessage}</span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      disabled={
                        !item.latestVersionId ||
                        busyVersionId === item.latestVersionId ||
                        item.status === 'processing'
                      }
                      onClick={() => {
                        void triggerReprocess(item)
                      }}
                      className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {busyVersionId === item.latestVersionId ? 'Iniciando...' : 'Reprocesar'}
                    </button>
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

function StatusPill({ status }: { status: DocumentVersionStatus }) {
  const className =
    status === 'ready'
      ? 'border-green-200 bg-green-50 text-green-800'
      : status === 'processing'
        ? 'border-blue-200 bg-blue-50 text-blue-800'
        : status === 'error'
          ? 'border-red-200 bg-red-50 text-red-800'
          : 'border-gray-200 bg-gray-50 text-gray-700'

  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${className}`}>
      {status === 'processing' ? (
        <span className="flex items-center gap-1">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
          {status}
        </span>
      ) : (
        status
      )}
    </span>
  )
}
