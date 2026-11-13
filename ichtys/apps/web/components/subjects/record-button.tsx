'use client'

/**
 * El botón que prende y apaga la grabadora del dictado.
 *
 * Un solo control, grande, con tres estados que se distinguen sin leer: en reposo
 * (micrófono), grabando (rojo, con el tiempo corriendo y el nivel de la voz) y
 * ocupado (el equipo está transcribiendo). Solo presenta: la grabación la maneja
 * quien lo usa. Se opera con mouse, con Enter o con la barra espaciadora.
 */
export type RecordButtonState = 'idle' | 'recording' | 'busy'

export interface RecordButtonProps {
  state: RecordButtonState
  /** Segundos grabados. */
  seconds: number
  /** Nivel del micrófono, de 0 a 1. */
  level: number
  /** Sin voz durante unos segundos: se avisa junto al botón. */
  silent?: boolean
  onStart: () => void
  onStop: () => void
}

export function recordingClock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

const BARS = 5

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
    </svg>
  )
}

function StopIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  )
}

function Spinner() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="animate-spin motion-reduce:animate-none" aria-hidden="true">
      <path d="M12 3a9 9 0 1 0 9 9" />
    </svg>
  )
}

export function RecordButton({ state, seconds, level, silent = false, onStart, onStop }: RecordButtonProps) {
  const recording = state === 'recording'
  const busy = state === 'busy'
  const lit = Math.round(Math.max(0, Math.min(1, level)) * BARS)

  return (
    <div className="flex items-center gap-4">
      <span className="relative inline-flex h-16 w-16 shrink-0 items-center justify-center">
        {recording ? (
          <span className="absolute inset-0 rounded-full bg-red-500 opacity-40 animate-ping motion-reduce:hidden" aria-hidden="true" />
        ) : null}
        <button
          type="button"
          onClick={recording ? onStop : onStart}
          disabled={busy}
          aria-pressed={recording}
          aria-label={recording ? `Detener la grabación (${recordingClock(seconds)})` : busy ? 'Transcribiendo el dictado' : 'Grabar el dictado'}
          className={[
            'relative inline-flex h-16 w-16 items-center justify-center rounded-full text-white shadow-alphi-panel transition-colors',
            'focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2',
            recording
              ? 'bg-red-600 hover:bg-red-700 focus-visible:outline-red-300'
              : 'bg-alphi-ink hover:opacity-90 focus-visible:outline-sky-300 disabled:cursor-wait disabled:opacity-60',
          ].join(' ')}
        >
          {busy ? <Spinner /> : recording ? <StopIcon /> : <MicIcon />}
        </button>
      </span>

      <div className="min-w-0">
        {recording ? (
          <>
            <p className="flex items-center gap-3 text-sm font-semibold text-red-700">
              <span>Grabando</span>
              <span className="tabular-nums" role="timer" aria-live="off">
                {recordingClock(seconds)}
              </span>
              <span className="flex h-5 items-end gap-0.5" role="meter" aria-label="Nivel del micrófono" aria-valuemin={0} aria-valuemax={BARS} aria-valuenow={lit}>
                {Array.from({ length: BARS }, (_, index) => (
                  <span
                    key={index}
                    className={`w-1.5 rounded-sm ${index < lit ? 'bg-red-600' : 'bg-red-200'}`}
                    style={{ height: `${40 + index * 15}%` }}
                  />
                ))}
              </span>
            </p>
            <p className={`text-xs ${silent ? 'font-semibold text-amber-800' : 'text-alphi-muted'}`} role={silent ? 'alert' : undefined}>
              {silent ? 'No llega voz al micrófono. Revisá que sea el correcto y que no esté silenciado.' : 'Tocá el botón de nuevo para terminar.'}
            </p>
          </>
        ) : (
          <>
            <p className="text-sm font-semibold text-alphi-ink">{busy ? 'Transcribiendo…' : 'Dictar'}</p>
            <p className="text-xs text-alphi-muted">
              {busy ? 'El botón vuelve cuando el borrador esté listo.' : 'Tocá el micrófono y hablá como en la consulta. Tocá de nuevo para terminar.'}
            </p>
          </>
        )}
      </div>
    </div>
  )
}
