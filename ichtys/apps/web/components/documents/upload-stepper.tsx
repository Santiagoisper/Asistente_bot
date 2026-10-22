'use client'

import React from 'react'

export type UploadStage = 'uploading' | 'parsing' | 'indexing' | 'extracting' | 'ready' | 'error'

const STAGE_ORDER: readonly Exclude<UploadStage, 'error'>[] = ['uploading', 'parsing', 'indexing', 'extracting', 'ready']

const STAGE_LABEL: Record<Exclude<UploadStage, 'error'>, string> = {
  uploading: 'Subiendo',
  parsing: 'Leyendo PDF',
  indexing: 'Indexando',
  extracting: 'Extrayendo visitas y criterios',
  ready: 'Listo',
}

export interface UploadStepperProps {
  /** Etapa real del procesamiento (subida → lectura → indexado → extracción → listo), o 'error' si algo falló. */
  stage: UploadStage
  /** Progreso 0–100 dentro de la etapa actual (hoy solo tiene sentido en 'uploading', bytes subidos). Opcional. */
  progress?: number
  /** Mensaje de error en español para mostrar cuando stage === 'error'. */
  errorMessage?: string
}

/**
 * Indicador de etapas del procesamiento de un documento. Puramente visual —
 * no decide ni mide el progreso real, solo lo muestra. El llamador (que hace
 * el polling del estado real) le pasa `stage` y, si corresponde, `progress`
 * o `errorMessage`.
 */
export function UploadStepper({ stage, progress, errorMessage }: UploadStepperProps) {
  if (stage === 'error') {
    return (
      <div className="flex w-full max-w-sm flex-col items-center gap-2 text-center">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-alphi-rose/10 text-alphi-rose">
          &#9888;
        </span>
        <p className="text-sm font-semibold text-alphi-rose">No se pudo procesar el documento</p>
        {errorMessage && <p className="text-xs text-alphi-muted">{errorMessage}</p>}
      </div>
    )
  }

  const activeIndex = STAGE_ORDER.indexOf(stage)

  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-2">
      <div
        className="flex w-full items-center"
        role="progressbar"
        aria-label="Progreso del procesamiento del documento"
        aria-valuenow={activeIndex + 1}
        aria-valuemin={1}
        aria-valuemax={STAGE_ORDER.length}
        aria-valuetext={`Paso ${activeIndex + 1} de ${STAGE_ORDER.length}: ${STAGE_LABEL[stage]}`}
      >
        {STAGE_ORDER.map((s, i) => {
          const done = i < activeIndex || stage === 'ready'
          const current = i === activeIndex && stage !== 'ready'
          return (
            <React.Fragment key={s}>
              {i > 0 && (
                <div className={['mx-0.5 h-0.5 flex-1', i <= activeIndex ? 'bg-alphi-teal' : 'bg-alphi-border'].join(' ')} />
              )}
              <div
                title={STAGE_LABEL[s]}
                className={[
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold',
                  done
                    ? 'bg-alphi-teal text-white'
                    : current
                      ? 'border-2 border-alphi-teal text-alphi-teal'
                      : 'border border-alphi-border text-alphi-border',
                ].join(' ')}
              >
                {done ? '✓' : i + 1}
              </div>
            </React.Fragment>
          )
        })}
      </div>
      <p className="text-xs font-medium text-alphi-navy">
        {STAGE_LABEL[stage]}
        {stage === 'uploading' && typeof progress === 'number' ? ` · ${Math.round(progress)}%` : ''}
      </p>
    </div>
  )
}
