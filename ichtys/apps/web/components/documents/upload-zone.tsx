'use client'

import React, { useCallback, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

interface UploadZoneProps {
  studyId: string
  onUploadComplete?: () => void
}

const ACCEPT_TYPES = ['.pdf', '.docx', '.doc', '.txt']

const DOC_TYPES = [
  { label: 'Protocolo / Enmiendas', ext: 'PDF', tip: 'ICH M11, versiones con track changes' },
  { label: 'Manual del Investigador', ext: 'PDF', tip: 'IB, IBs anteriores para comparar' },
  { label: 'Consentimiento (ICF)', ext: 'PDF/DOC', tip: 'Versiones aprobadas por CEBR' },
  { label: 'SOPs del sitio', ext: 'DOC/PDF', tip: 'Procedimientos operativos locales' },
  { label: 'Guia de visitas (SoA)', ext: 'PDF', tip: 'Schedule of Assessments detallado' },
  { label: 'Otro documento', ext: 'PDF/DOC/TXT', tip: 'Labs, instrucciones, budgets' },
]

/** Mapeo índice → documentType para el backend. */
const DOC_TYPE_VALUES = [
  'protocol',
  'investigator_brochure',
  'other',
  'other',
  'other',
  'other',
] as const

type UploadStatus = 'idle' | 'uploading' | 'processing' | 'success' | 'error'

interface UploadState {
  status: UploadStatus
  fileName: string | null
  progress: number
  errorMessage: string | null
  elapsed: number
}

const INITIAL_STATE: UploadState = {
  status: 'idle',
  fileName: null,
  progress: 0,
  errorMessage: null,
  elapsed: 0,
}

export function UploadZone({ studyId, onUploadComplete }: UploadZoneProps) {
  const router = useRouter()
  const [state, setState] = useState<UploadState>(INITIAL_STATE)
  const [isDragging, setIsDragging] = useState(false)
  // Default a 0 (Protocolo) — el caso de uso principal de ALPHI.
  const [selectedDocType, setSelectedDocType] = useState<number>(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const startTimer = useCallback(() => {
    setState((s) => ({ ...s, elapsed: 0 }))
    timerRef.current = setInterval(() => {
      setState((s) => ({ ...s, elapsed: s.elapsed + 1 }))
    }, 1000)
  }, [])

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const handleFile = useCallback(async (file: File) => {
    if (!file) return
    setState({ status: 'uploading', fileName: file.name, progress: 0, errorMessage: null, elapsed: 0 })
    startTimer()

    const formData = new FormData()
    formData.append('file', file)
    formData.append('studyId', studyId)
    formData.append('documentType', DOC_TYPE_VALUES[selectedDocType] ?? 'other')

    try {
      const xhr = new XMLHttpRequest()
      xhr.upload.addEventListener('progress', (ev) => {
        if (ev.lengthComputable) {
          setState((s) => ({ ...s, progress: Math.round((ev.loaded / ev.total) * 100) }))
        }
      })

      await new Promise<void>((resolve, reject) => {
        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve()
          else reject(new Error(`HTTP ${xhr.status}`))
        })
        xhr.addEventListener('error', () => reject(new Error('Network error')))
        xhr.open('POST', '/api/documents/upload')
        xhr.send(formData)
      })

      // Parsear la respuesta para obtener el documentVersionId.
      let documentVersionId: string | null = null
      try {
        const uploadResult = JSON.parse(xhr.responseText) as { documentVersionId?: string }
        documentVersionId = uploadResult.documentVersionId ?? null
      } catch {
        // silencioso — el usuario puede reprocesar manualmente
      }

      setState((s) => ({ ...s, status: 'processing', progress: 100 }))

      // Disparar ingestion. La route retorna 202 inmediatamente (usa after()
      // internamente para correr en background). No necesitamos fire-and-forget.
      if (documentVersionId) {
        await fetch('/api/ingestion/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ documentVersionId }),
        }).catch(() => {
          // silencioso — el usuario puede reprocesar manualmente
        })
      }

      // Pequeño delay para dar feedback visual antes de volver al idle.
      await new Promise((r) => setTimeout(r, 800))
      stopTimer()
      setState((s) => ({ ...s, status: 'success' }))

      // Actualizar el server component para que aparezca el nuevo documento.
      router.refresh()
      onUploadComplete?.()

      setTimeout(() => setState(INITIAL_STATE), 3200)
    } catch (err) {
      stopTimer()
      const msg = err instanceof Error ? err.message : 'Error desconocido'
      setState({ status: 'error', fileName: file.name, progress: 0, errorMessage: msg, elapsed: 0 })
    }
  }, [studyId, selectedDocType, startTimer, stopTimer, onUploadComplete, router])

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) void handleFile(file)
  }, [handleFile])

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback(() => setIsDragging(false), [])

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) void handleFile(file)
    e.target.value = ''
  }, [handleFile])

  const handleReset = useCallback(() => {
    stopTimer()
    setState(INITIAL_STATE)
  }, [stopTimer])

  const { status, fileName, progress, errorMessage, elapsed } = state

  if (status === 'success') {
    return (
      <div className="alphi-card flex flex-col items-center gap-3 px-6 py-8 text-center">
        <span className="text-5xl text-alphi-sage">&#10003;</span>
        <div>
          <p className="text-base font-bold text-alphi-navy">Documento procesado</p>
          <p className="mt-0.5 text-sm text-alphi-muted">
            <strong>{fileName}</strong> ya esta disponible para consultas.
          </p>
        </div>
        <button type="button" onClick={handleReset} className="alphi-btn-secondary mt-1">
          Subir otro documento
        </button>
      </div>
    )
  }

  if (status === 'uploading' || status === 'processing') {
    return (
      <div className="alphi-card flex flex-col items-center gap-4 px-6 py-8 text-center">
        <div className="flex items-center gap-2 text-sm text-alphi-muted">
          <span className="inline-flex items-center gap-0.5 text-alphi-teal">
            <span className="alphi-typing-dot" />
            <span className="alphi-typing-dot" />
            <span className="alphi-typing-dot" />
          </span>
          <span className="ml-1">
            {status === 'uploading' ? 'Subiendo...' : 'Procesando e indexando...'}
          </span>
        </div>
        <p className="font-mono text-sm text-alphi-navy">{fileName}</p>
        {status === 'uploading' && (
          <div className="h-2 w-full max-w-xs overflow-hidden rounded-full bg-alphi-slate">
            <div
              className="h-full rounded-full bg-alphi-teal transition-all duration-200"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
        {status === 'processing' && (
          <p className="text-xs text-alphi-muted">Vectorizando fragmentos... {elapsed}s</p>
        )}
        <p className="max-w-xs text-xs text-alphi-muted">
          Los protocolos largos pueden tardar 1-2 minutos dependiendo del numero de paginas.
        </p>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="alphi-card flex flex-col items-center gap-3 px-6 py-8 text-center">
        <span className="text-4xl">&#9888;</span>
        <div>
          <p className="text-base font-bold text-alphi-rose">Error al subir el documento</p>
          <p className="mt-0.5 text-sm text-alphi-muted">{fileName}</p>
          {errorMessage && (
            <p className="mt-1 font-mono text-xs text-alphi-rose/70">{errorMessage}</p>
          )}
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={handleReset} className="alphi-btn-secondary">
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="alphi-btn-primary"
          >
            Reintentar
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="alphi-label mb-2">Tipo de documento</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {DOC_TYPES.map((dt, idx) => (
            <button
              key={dt.label}
              type="button"
              onClick={() => setSelectedDocType(idx)}
              title={dt.tip}
              className={[
                'rounded-lg border px-3 py-2 text-left text-xs transition-all duration-100',
                idx === selectedDocType
                  ? 'border-alphi-teal/60 bg-alphi-teal/10 text-alphi-navy'
                  : 'border-alphi-border bg-white text-alphi-muted hover:border-alphi-teal/40 hover:text-alphi-navy',
              ].join(' ')}
            >
              <span className="block font-semibold leading-tight">{dt.label}</span>
              <span className="mt-0.5 block font-mono text-[10px] text-alphi-muted">{dt.ext}</span>
            </button>
          ))}
        </div>
        {DOC_TYPES[selectedDocType] && (
          <p className="mt-1.5 text-[11px] text-alphi-muted">
            {DOC_TYPES[selectedDocType]?.tip}
          </p>
        )}
      </div>

      <div
        role="button"
        tabIndex={0}
        aria-label="Zona de carga de documentos"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click() }}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={[
          'flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-all duration-150',
          isDragging
            ? 'border-alphi-teal bg-alphi-teal/5'
            : 'border-alphi-border bg-white hover:border-alphi-teal/50 hover:bg-alphi-teal/5',
        ].join(' ')}
      >
        <span className="text-4xl">&#128196;</span>
        <div>
          <p className="text-sm font-semibold text-alphi-navy">
            {isDragging ? 'Soltar aqui' : 'Arrastra el documento o hace clic'}
          </p>
          <p className="mt-0.5 text-xs text-alphi-muted">
            Formatos: {ACCEPT_TYPES.join(', ')} hasta 50 MB
          </p>
        </div>
        <span className="alphi-btn-secondary pointer-events-none text-xs">
          Elegir archivo
        </span>
        <input
          ref={inputRef}
          type="file"
          className="sr-only"
          accept={ACCEPT_TYPES.join(',')}
          onChange={handleInputChange}
        />
      </div>

      <div className="rounded-lg border border-alphi-amber/20 bg-alphi-amber/5 px-4 py-2.5">
        <p className="text-[11px] leading-relaxed text-alphi-navy/70">
          <strong className="text-alphi-amber">GCP - Privacidad:</strong>{' '}
          No subas documentos con datos identificables de pacientes. Solo protocolos, manuales,
          SOPs y documentos de referencia sin PHI. Archivos aislados por estudio y organizacion.
        </p>
      </div>
    </div>
  )
}
