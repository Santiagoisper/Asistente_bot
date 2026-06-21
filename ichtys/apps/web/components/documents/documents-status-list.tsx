'use client'

import React, { useMemo, useState } from 'react'

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

export function DocumentsStatusList({ items }: { items: DocumentStatusItem[] }) {
  const [busyVersionId, setBusyVersionId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [localStatusByVersion, setLocalStatusByVersion] = useState<Record<string, DocumentVersionStatus>>({})
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

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
    setSuccessMessage(null)

    try {
      const response = await fetch('/api/ingestion/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentVersionId: item.latestVersionId }),
      })
      if (!response.ok) {
        setActionError('No se pudo iniciar el reprocesamiento.')
        return
      }
      setLocalStatusByVersion((current) => ({ ...current, [item.latestVersionId!]: 'processing' }))
      setSuccessMessage('Reprocesamiento iniciado. Actualizá la página en unos segundos para ver el resultado.')
    } catch {
      setActionError('Error de red al iniciar reprocesamiento.')
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
      {successMessage ? (
        <p className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800">
          {successMessage}
        </p>
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
              {sortedItems.map((item) => {
                const status = item.latestVersionId
                  ? (localStatusByVersion[item.latestVersionId] ?? item.status)
                  : item.status

                return (
                  <tr key={item.documentId}>
                    <td className="px-3 py-2 text-gray-900">{item.documentName}</td>
                    <td className="px-3 py-2 text-gray-700">{item.documentType}</td>
                    <td className="px-3 py-2">
                      <StatusPill status={status} />
                    </td>
                    <td className="px-3 py-2 text-gray-700">{item.pageCount ?? '—'}</td>
                    <td className="max-w-xs px-3 py-2 text-gray-700">
                      {item.errorMessage ? <span className="break-words">{item.errorMessage}</span> : '—'}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        disabled={!item.latestVersionId || busyVersionId === item.latestVersionId}
                        onClick={() => {
                          void triggerReprocess(item)
                        }}
                        className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {busyVersionId === item.latestVersionId ? 'Iniciando...' : 'Reprocesar'}
                      </button>
                    </td>
                  </tr>
                )
              })}
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

  return <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${className}`}>{status}</span>
}
