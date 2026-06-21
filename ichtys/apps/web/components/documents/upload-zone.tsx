'use client'

import React, { useCallback, useRef, useState } from 'react'

type DocumentType = 'protocol' | 'investigator_brochure' | 'lab_manual' | 'pharmacy_manual' | 'other'

type UploadState =
  | { phase: 'idle' }
  | { phase: 'uploading' }
  | { phase: 'processing'; documentId: string; documentVersionId: string }
  | { phase: 'ready'; pageCount: number | null }
  | { phase: 'error'; message: string }

const DOC_TYPE_LABELS: Record<DocumentType, string> = {
  protocol: 'Protocolo',
  investigator_brochure: 'Brochure del Investigador',
  lab_manual: 'Manual de Laboratorio',
  pharmacy_manual: 'Manual de Farmacia',
  other: 'Otro',
}

const MAX_BYTES = 50 * 1024 * 1024

interface UploadZoneProps {
  studyId: string
}

export function UploadZone({ studyId }: UploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [docType, setDocType] = useState<DocumentType>('protocol')
  const [dragOver, setDragOver] = useState(false)
  const [state, setState] = useState<UploadState>({ phase: 'idle' })

  const acceptFile = useCallback((f: File) => {
    if (f.type !== 'application/pdf') {
      setState({ phase: 'error', message: 'Solo se aceptan archivos PDF.' })
      return
    }
    if (f.size > MAX_BYTES) {
      setState({ phase: 'error', message: 'El archivo supera el límite de 50 MB.' })
      return
    }
    setFile(f)
    setState({ phase: 'idle' })
  }, [])

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      const f = e.dataTransfer.files[0]
      if (f) acceptFile(f)
    },
    [acceptFile],
  )

  async function runIngestionAndPoll(documentId: string, documentVersionId: string) {
    setState({ phase: 'processing', documentId, documentVersionId })

    const ingRes = await fetch('/api/ingestion/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ documentVersionId }),
    })
    if (!ingRes.ok) {
      setState({ phase: 'error', message: 'No se pudo iniciar el procesamiento.' })
      return
    }

    for (let i = 0; i < 40; i++) {
      await new Promise<void>((r) => setTimeout(r, 3000))
      const res = await fetch(`/api/documents/${documentId}/status`)
      if (!res.ok) continue
      const data = (await res.json()) as { status: string; pageCount: number | null }
      if (data.status === 'ready') {
        setState({ phase: 'ready', pageCount: data.pageCount })
        setFile(null)
        return
      }
      if (data.status === 'error') {
        setState({ phase: 'error', message: 'El procesamiento falló. Intentá de nuevo.' })
        return
      }
    }
    setState({ phase: 'error', message: 'El procesamiento tardó demasiado.' })
  }

  async function handleUpload() {
    if (!file) return
    setState({ phase: 'uploading' })

    try {
      const form = new FormData()
      form.append('file', file)
      form.append('studyId', studyId)
      form.append('documentType', docType)

      const res = await fetch('/api/documents/upload', { method: 'POST', body: form })
      if (!res.ok) {
        const text = await res.text()
        setState({ phase: 'error', message: text || 'Error al subir el archivo.' })
        return
      }
      const data = (await res.json()) as { documentId: string; documentVersionId: string }
      await runIngestionAndPoll(data.documentId, data.documentVersionId)
    } catch {
      setState({ phase: 'error', message: 'Error de red. Revisá tu conexión.' })
    }
  }

  const busy = state.phase === 'uploading' || state.phase === 'processing'

  return (
    <div className="space-y-4">
      <div
        role="button"
        tabIndex={0}
        aria-label="Área de carga de PDF"
        onClick={() => !busy && inputRef.current?.click()}
        onKeyDown={(e) => !busy && e.key === 'Enter' && inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={[
          'flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-10 text-sm transition-colors',
          busy ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
          dragOver
            ? 'border-blue-500 bg-blue-50'
            : 'border-gray-300 bg-gray-50 hover:border-gray-400',
        ].join(' ')}
      >
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) acceptFile(f)
            e.target.value = ''
          }}
        />
        {file ? (
          <span className="font-medium text-gray-700">{file.name}</span>
        ) : (
          <>
            <span className="text-gray-500">Arrastrá un PDF o hacé click para seleccionarlo</span>
            <span className="text-xs text-gray-400">Máximo 50 MB</span>
          </>
        )}
      </div>

      <div className="flex items-center gap-3">
        <label htmlFor="doc-type" className="whitespace-nowrap text-sm font-medium text-gray-700">
          Tipo de documento
        </label>
        <select
          id="doc-type"
          value={docType}
          disabled={busy}
          onChange={(e) => setDocType(e.target.value as DocumentType)}
          className="flex-1 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
        >
          {Object.entries(DOC_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {state.phase === 'idle' && (
        <button
          type="button"
          disabled={!file}
          onClick={handleUpload}
          className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Subir documento
        </button>
      )}

      {state.phase === 'uploading' && (
        <p className="text-center text-sm text-gray-500">Subiendo archivo...</p>
      )}

      {state.phase === 'processing' && (
        <p className="text-center text-sm text-gray-500">
          Procesando documento, esto puede tardar un minuto...
        </p>
      )}

      {state.phase === 'ready' && (
        <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          Documento listo
          {state.pageCount !== null && state.pageCount !== undefined && ` — ${state.pageCount} páginas indexadas`}.{' '}
          <button
            type="button"
            className="underline"
            onClick={() => setState({ phase: 'idle' })}
          >
            Subir otro
          </button>
        </div>
      )}

      {state.phase === 'error' && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {state.message}{' '}
          <button
            type="button"
            className="underline"
            onClick={() => setState({ phase: 'idle' })}
          >
            Reintentar
          </button>
        </div>
      )}
    </div>
  )
}
