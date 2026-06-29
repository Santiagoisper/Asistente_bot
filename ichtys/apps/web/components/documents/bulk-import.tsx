'use client'

import Link from 'next/link'
import React, { useCallback, useEffect, useRef, useState } from 'react'

type ItemStatus = 'pending' | 'processing' | 'ready' | 'error'

type QueuedItem = {
  fileName: string
  studyId: string | null
  documentVersionId: string | null
  status: ItemStatus
  error: string | null
}

type BulkImportResponse = {
  jobId: string
  batchId: string
  queued: number
  total: number
  items: Array<{
    jobId: string | null
    fileName: string
    studyId: string | null
    documentVersionId: string | null
    status: 'queued' | 'error'
    error: string | null
  }>
}

type BatchStatusResponse = {
  batchId: string
  total: number
  ready: number
  processing: number
  error: number
  items: Array<{
    jobId: string
    fileName: string
    studyId: string | null
    documentVersionId: string | null
    status: ItemStatus
    error: string | null
  }>
}

const POLL_INTERVAL_MS = 4_000

function statusLabel(status: ItemStatus): string {
  switch (status) {
    case 'pending':
      return 'En cola'
    case 'processing':
      return 'Procesando e indexando...'
    case 'ready':
      return 'Listo'
    case 'error':
      return 'Error'
  }
}

function statusClass(status: ItemStatus): string {
  switch (status) {
    case 'ready':
      return 'border-alphi-sage/30 bg-alphi-sage/10 text-alphi-sage'
    case 'processing':
      return 'border-alphi-teal/30 bg-alphi-teal/10 text-alphi-teal'
    case 'error':
      return 'border-alphi-rose/30 bg-alphi-rose/10 text-alphi-rose'
    case 'pending':
      return 'border-alphi-border bg-alphi-slate text-alphi-muted'
  }
}

export function BulkImport() {
  const [files, setFiles] = useState<File[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [items, setItems] = useState<QueuedItem[]>([])
  const [batchId, setBatchId] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const addFiles = useCallback((incoming: FileList | File[]) => {
    const pdfs = Array.from(incoming).filter(
      (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'),
    )
    setFiles((prev) => {
      const existing = new Set(prev.map((f) => `${f.name}:${f.size}`))
      const merged = [...prev]
      for (const f of pdfs) {
        if (!existing.has(`${f.name}:${f.size}`)) merged.push(f)
      }
      return merged
    })
  }, [])

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
    if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files)
  }, [addFiles])

  const removeFile = useCallback((idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx))
  }, [])

  const pollBatch = useCallback(async (currentBatchId: string) => {
    try {
      const res = await fetch(`/api/studies/bulk-import/${currentBatchId}`, { cache: 'no-store' })
      if (!res.ok) return
      const data = (await res.json()) as BatchStatusResponse
      setItems(
        data.items.map((it) => ({
          fileName: it.fileName,
          studyId: it.studyId,
          documentVersionId: it.documentVersionId,
          status: it.status,
          error: it.error,
        })),
      )
    } catch {
      // silencioso — reintenta en el próximo ciclo
    }
  }, [])

  useEffect(() => {
    if (!batchId) return

    const anyInFlight = items.some((it) => it.status === 'pending' || it.status === 'processing')

    if (!anyInFlight) {
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
        pollingRef.current = null
      }
      return
    }

    if (pollingRef.current) return

    pollingRef.current = setInterval(() => {
      void pollBatch(batchId)
    }, POLL_INTERVAL_MS)

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
        pollingRef.current = null
      }
    }
  }, [batchId, items, pollBatch])

  const handleSubmit = useCallback(async () => {
    if (files.length === 0) return
    setIsSubmitting(true)
    setSubmitError(null)

    const formData = new FormData()
    for (const f of files) formData.append('files', f)

    try {
      const res = await fetch('/api/studies/bulk-import', { method: 'POST', body: formData })
      if (!res.ok) {
        setSubmitError('No se pudo iniciar la importación. Intentá de nuevo.')
        return
      }
      const data = (await res.json()) as BulkImportResponse
      setBatchId(data.batchId)
      setItems(
        data.items.map((it) => ({
          fileName: it.fileName,
          studyId: it.studyId,
          documentVersionId: it.documentVersionId,
          status: it.status === 'error' ? 'error' : 'pending',
          error: it.error,
        })),
      )
      setFiles([])
      // Poll inmediato para reflejar estado inicial.
      void pollBatch(data.batchId)
    } catch {
      setSubmitError('Error de red. Revisá tu conexión.')
    } finally {
      setIsSubmitting(false)
    }
  }, [files, pollBatch])

  const allDone = items.length > 0 && items.every((it) => it.status === 'ready' || it.status === 'error')
  const readyCount = items.filter((it) => it.status === 'ready').length

  return (
    <div className="space-y-5">
      {/* Drop zone */}
      <div
        role="button"
        tabIndex={0}
        aria-label="Zona de carga masiva de protocolos"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click() }}
        onDrop={handleDrop}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
        onDragLeave={() => setIsDragging(false)}
        className={[
          'flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-all duration-150',
          isDragging
            ? 'border-alphi-teal bg-alphi-teal/5'
            : 'border-alphi-border bg-white hover:border-alphi-teal/50 hover:bg-alphi-teal/5',
        ].join(' ')}
      >
        <span className="text-4xl">&#128218;</span>
        <div>
          <p className="text-sm font-semibold text-alphi-navy">
            {isDragging ? 'Soltar aquí' : 'Arrastrá varios protocolos o hacé clic'}
          </p>
          <p className="mt-0.5 text-xs text-alphi-muted">
            Un estudio por cada PDF. Formato: PDF (hasta 50 MB c/u, máx. 25 archivos).
          </p>
        </div>
        <span className="alphi-btn-secondary pointer-events-none text-xs">Elegir archivos</span>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="sr-only"
          accept=".pdf"
          onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = '' }}
        />
      </div>

      {/* Selected files (pre-submit) */}
      {files.length > 0 && items.length === 0 && (
        <div className="alphi-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-semibold text-alphi-navy">
              {files.length} archivo{files.length !== 1 ? 's' : ''} seleccionado{files.length !== 1 ? 's' : ''}
            </p>
            <button type="button" onClick={() => setFiles([])} className="alphi-btn-ghost text-xs">
              Limpiar
            </button>
          </div>
          <ul className="space-y-1.5">
            {files.map((f, idx) => (
              <li key={`${f.name}:${f.size}`} className="flex items-center justify-between gap-3 rounded-md border border-alphi-border/60 bg-white px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-sm text-alphi-navy">{f.name}</span>
                <span className="shrink-0 font-mono text-[11px] text-alphi-muted">{(f.size / 1024 / 1024).toFixed(1)} MB</span>
                <button type="button" onClick={() => removeFile(idx)} className="shrink-0 text-alphi-muted hover:text-alphi-rose" aria-label={`Quitar ${f.name}`}>
                  &times;
                </button>
              </li>
            ))}
          </ul>

          {submitError && <p className="mt-3 text-sm text-alphi-rose">{submitError}</p>}

          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={isSubmitting}
            className="alphi-btn-primary mt-4 w-full justify-center"
          >
            {isSubmitting ? 'Importando...' : `Importar ${files.length} protocolo${files.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      )}

      {/* Progress (post-submit) */}
      {items.length > 0 && (
        <div className="alphi-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-semibold text-alphi-navy">
              Importación: {readyCount}/{items.length} listos
            </p>
            {allDone && (
              <Link href="/library" className="alphi-btn-secondary text-xs">
                Ver librería
              </Link>
            )}
          </div>
          <ul className="space-y-1.5">
            {items.map((it) => (
              <li key={it.fileName} className="flex items-center justify-between gap-3 rounded-md border border-alphi-border/60 bg-white px-3 py-2">
                <div className="min-w-0 flex-1">
                  {it.studyId ? (
                    <Link href={`/studies/${it.studyId}/documents`} className="truncate text-sm font-medium text-alphi-navy hover:text-alphi-teal">
                      {it.fileName}
                    </Link>
                  ) : (
                    <span className="truncate text-sm text-alphi-navy">{it.fileName}</span>
                  )}
                  {it.error && <p className="text-xs text-alphi-rose">{it.error}</p>}
                </div>
                <span className={['shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium', statusClass(it.status)].join(' ')}>
                  {statusLabel(it.status)}
                </span>
              </li>
            ))}
          </ul>
          {!allDone && (
            <p className="mt-3 text-xs text-alphi-muted">
              Las ingestiones corren en segundo plano. Esta vista se actualiza sola; podés cerrarla y volver más tarde.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
