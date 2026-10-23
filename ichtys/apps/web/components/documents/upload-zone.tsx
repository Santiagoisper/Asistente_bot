'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  INGESTION_STAGE_LABELS,
  POLL_INTERVAL_MS,
  POLL_MAX_DURATION_MS,
  type IngestionStageId,
} from '../../lib/documents/ingestion-stage'

interface UploadZoneProps {
  studyId: string
  onUploadComplete?: () => void
}

// El motor de ingesta solo procesa PDF por ahora (parsePdf / pdf-parse).
// docx/doc/txt todavia no estan soportados — la UI debe reflejar la realidad.
const ACCEPT_TYPES = ['.pdf']

const DOC_TYPES = [
  { label: 'Protocolo / Enmiendas', ext: 'PDF', tip: 'ICH M11, versiones con track changes' },
  { label: 'Manual del Investigador', ext: 'PDF', tip: 'IB, IBs anteriores para comparar' },
  { label: 'Consentimiento (ICF)', ext: 'PDF', tip: 'Versiones aprobadas por CEBR (en PDF)' },
  { label: 'SOPs del sitio', ext: 'PDF', tip: 'Procedimientos operativos locales (en PDF)' },
  { label: 'Guia de visitas (SoA)', ext: 'PDF', tip: 'Schedule of Assessments detallado' },
  { label: 'Otro documento', ext: 'PDF', tip: 'Labs, instrucciones, budgets (en PDF)' },
]

/** Mapeo índice → documentType para el backend. */
const DOC_TYPE_VALUES = [
  'protocol',
  'investigator_brochure',
  'other',
  'other',
  'soa',
  'other',
] as const

type UploadStatus = 'idle' | 'uploading' | 'processing' | 'success' | 'error'

interface UploadState {
  status: UploadStatus
  fileName: string | null
  progress: number
  errorMessage: string | null
  elapsed: number
  /** Etapa real de la ingesta, del polling a /api/documents/[id]/status. */
  stage: IngestionStageId | null
  stageLabel: string | null
  chunksEmbedded: number
  chunksTotal: number
}

const INITIAL_STATE: UploadState = {
  status: 'idle',
  fileName: null,
  progress: 0,
  errorMessage: null,
  elapsed: 0,
  stage: null,
  stageLabel: null,
  chunksEmbedded: 0,
  chunksTotal: 0,
}

interface IngestionStatusResponse {
  status: 'pending' | 'processing' | 'ready' | 'error'
  stage?: IngestionStageId
  stageLabel?: string
  chunksEmbedded?: number
  chunksTotal?: number
  errorMessage?: string | null
}

/** Errores de red consecutivos tolerados antes de dar por perdida la conexión. */
const MAX_POLL_FAILURES = 3

export function UploadZone({ studyId, onUploadComplete }: UploadZoneProps) {
  const router = useRouter()
  const [state, setState] = useState<UploadState>(INITIAL_STATE)
  const [isDragging, setIsDragging] = useState(false)
  // Default a 0 (Protocolo) — el caso de uso principal de ALPHI.
  const [selectedDocType, setSelectedDocType] = useState<number>(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }, [])

  // Al desmontar (navegación): cortar timers — sin esto el polling seguía vivo.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current)
    }
  }, [])

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

  /**
   * Polling del estado REAL de la versión: la ingesta corre en background
   * (after() en /api/ingestion/run) y antes mostrábamos "éxito" a los 800 ms
   * de dispararla, cuando apenas empezaba. Acá esperamos el estado verdadero
   * con sus etapas (leyendo PDF → indexando → extrayendo SoA → listo).
   */
  const pollIngestionStatus = useCallback(
    async (documentId: string, startedAt: number, failures: number) => {
      let data: IngestionStatusResponse
      try {
        const res = await fetch(`/api/documents/${documentId}/status`, { cache: 'no-store' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        data = (await res.json()) as IngestionStatusResponse
      } catch (err) {
        console.warn('[upload-zone] status poll failed', err)
        if (failures + 1 >= MAX_POLL_FAILURES) {
          stopTimer()
          stopPolling()
          setState((s) => ({
            ...s,
            status: 'error',
            errorMessage:
              'Se perdió la conexión mientras se procesaba el documento. El procesamiento sigue en el servidor: revisá el estado en la tabla de documentos en unos minutos.',
          }))
          return
        }
        pollTimerRef.current = setTimeout(
          () => void pollIngestionStatus(documentId, startedAt, failures + 1),
          POLL_INTERVAL_MS,
        )
        return
      }

      const stage = data.stage ?? null
      setState((s) => ({
        ...s,
        status: 'processing',
        stage,
        stageLabel: data.stageLabel ?? (stage ? INGESTION_STAGE_LABELS[stage] : null),
        chunksEmbedded: data.chunksEmbedded ?? 0,
        chunksTotal: data.chunksTotal ?? 0,
      }))

      if (data.status === 'error') {
        stopTimer()
        stopPolling()
        setState((s) => ({
          ...s,
          status: 'error',
          errorMessage:
            data.errorMessage ??
            'El documento no pudo procesarse. Intentá subirlo de nuevo o escribinos si sigue fallando.',
        }))
        router.refresh()
        return
      }

      if (data.status === 'ready') {
        stopTimer()
        stopPolling()
        setState((s) => ({ ...s, status: 'success', progress: 100, stage: 'ready', stageLabel: INGESTION_STAGE_LABELS.ready }))
        router.refresh()
        onUploadComplete?.()
        setTimeout(() => setState(INITIAL_STATE), 6000)
        return
      }

      if (Date.now() - startedAt > POLL_MAX_DURATION_MS) {
        // Protocolos muy largos: dejamos de ocupar la pantalla, pero el
        // proceso sigue en el servidor y se ve en la tabla de documentos.
        stopTimer()
        stopPolling()
        setState((s) => ({
          ...s,
          status: 'success',
          stage: null,
          stageLabel: 'Sigue procesándose en segundo plano',
        }))
        router.refresh()
        return
      }

      pollTimerRef.current = setTimeout(
        () => void pollIngestionStatus(documentId, startedAt, 0),
        POLL_INTERVAL_MS,
      )
    },
    [onUploadComplete, router, stopPolling, stopTimer],
  )

  const handleFile = useCallback(async (file: File) => {
    if (!file) return

    // Validacion temprana: solo PDF. Evita un 415 cript­ico del servidor y da
    // un mensaje claro al usuario.
    const isPdf =
      file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
    if (!isPdf) {
      setState({
        ...INITIAL_STATE,
        status: 'error',
        fileName: file.name,
        errorMessage:
          'Por ahora solo se procesan archivos PDF. Convertí el documento a PDF e intentá de nuevo.',
      })
      return
    }

    setState({ ...INITIAL_STATE, status: 'uploading', fileName: file.name })
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

      // Parsear la respuesta: se necesitan AMBOS ids (documentVersionId para
      // disparar la ingesta, documentId para consultar su estado real).
      let documentId: string | null = null
      let documentVersionId: string | null = null
      try {
        const uploadResult = JSON.parse(xhr.responseText) as {
          documentId?: string
          documentVersionId?: string
        }
        documentId = uploadResult.documentId ?? null
        documentVersionId = uploadResult.documentVersionId ?? null
      } catch (err) {
        console.error('[upload-zone] could not parse upload response', err)
      }

      setState((s) => ({
        ...s,
        status: 'processing',
        progress: 100,
        stage: 'queued',
        stageLabel: INGESTION_STAGE_LABELS.queued,
      }))

      if (!documentId || !documentVersionId) {
        // Antes esto seguía en silencio y el usuario veía un éxito falso.
        stopTimer()
        setState((s) => ({
          ...s,
          status: 'error',
          errorMessage:
            'La subida terminó pero no se pudo iniciar el procesamiento. Buscá el documento en la tabla de abajo y usá “Reprocesar”.',
        }))
        router.refresh()
        return
      }

      // Disparar la ingesta (202: corre en background con after()). El éxito
      // real lo decide el polling del estado — no un delay fijo.
      try {
        const ingestionRes = await fetch('/api/ingestion/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ documentVersionId }),
        })
        if (!ingestionRes.ok && ingestionRes.status !== 202) {
          throw new Error(`HTTP ${ingestionRes.status}`)
        }
      } catch (err) {
        // Antes esto era silencioso y el documento quedaba pendiente sin aviso.
        console.error('[upload-zone] failed to trigger ingestion', err)
        stopTimer()
        setState((s) => ({
          ...s,
          status: 'error',
          errorMessage:
            'El archivo se subió, pero no se pudo iniciar el procesamiento. Buscá el documento en la tabla de abajo y usá “Reprocesar”.',
        }))
        router.refresh()
        return
      }

      await pollIngestionStatus(documentId, Date.now(), 0)
    } catch (err) {
      stopTimer()
      const msg = err instanceof Error ? err.message : 'Error desconocido'
      setState({ ...INITIAL_STATE, status: 'error', fileName: file.name, errorMessage: msg })
    }
  }, [studyId, selectedDocType, startTimer, stopTimer, pollIngestionStatus, onUploadComplete, router])

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
    stopPolling()
    setState(INITIAL_STATE)
  }, [stopTimer, stopPolling])

  const { status, fileName, progress, errorMessage, elapsed, stage, stageLabel, chunksEmbedded, chunksTotal } = state

  const fullyProcessed = status === 'success' && stage === 'ready'

  if (status === 'success') {
    return (
      <div className="alphi-card flex flex-col items-center gap-3 px-6 py-8 text-center">
        <span className="text-5xl text-alphi-teal">&#8682;</span>
        <div>
          <p className="text-base font-bold text-alphi-navy">
            {fullyProcessed ? 'Documento procesado' : 'Documento subido'}
          </p>
          <p className="mt-0.5 text-sm text-alphi-muted">
            {fullyProcessed ? (
              <>
                <strong>{fileName}</strong> quedó listo: indexado y con sus visitas y
                criterios extraídos, disponible para consultas.
              </>
            ) : (
              <>
                <strong>{fileName}</strong> sigue procesandose en segundo plano.
              </>
            )}
          </p>
          {!fullyProcessed && (
            <p className="mt-1 text-xs text-alphi-muted">
              Puede tardar algunos minutos en protocolos largos. Segui el avance en la
              tabla de estado mas abajo.
            </p>
          )}
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
          <span className="ml-1" data-testid="upload-stage-label">
            {status === 'uploading'
              ? 'Subiendo...'
              : (stageLabel ?? 'Procesando e indexando...')}
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
          <>
            <div className="h-2 w-full max-w-xs overflow-hidden rounded-full bg-alphi-slate">
              <div
                className="h-full rounded-full bg-alphi-teal transition-all duration-300"
                style={{
                  width:
                    chunksTotal > 0 && stage === 'indexing'
                      ? `${Math.min(100, Math.round((chunksEmbedded / chunksTotal) * 100))}%`
                      : '100%',
                  opacity: chunksTotal > 0 && stage === 'indexing' ? 1 : 0.5,
                }}
              />
            </div>
            <p className="text-xs text-alphi-muted" data-testid="upload-stage-detail">
              {chunksTotal > 0 && stage === 'indexing'
                ? `Fragmentos: ${chunksEmbedded} de ${chunksTotal}`
                : stage === 'extracting'
                  ? 'Ultimo paso: visitas y criterios del protocolo'
                  : 'Puede tardar 1-2 minutos en protocolos largos'}
              {' — '}
              {elapsed}s
            </p>
          </>
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
            Formato: PDF (hasta 50 MB). Otros formatos: convertí a PDF por ahora.
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
