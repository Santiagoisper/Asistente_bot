'use client'

/**
 * Los controles de la grabadora del dictado: grabar, pausar, seguir y terminar.
 *
 * Cada control lleva su dibujo y su nombre escrito: nada depende de adivinar un
 * ícono. Solo presenta: la grabación la maneja quien lo usa. Se opera con mouse,
 * con Enter o con la barra espaciadora. Los colores son los del sistema
 * (`alphi-navy`, `alphi-rose`): una clase de color que no existe deja el botón
 * blanco sobre blanco, y eso pasó (12/11/2026).
 */
export type RecordButtonState = 'idle' | 'recording' | 'paused' | 'busy'

export interface RecordButtonProps {
  state: RecordButtonState
  /** Segundos grabados. */
  seconds: number
  /** Nivel del micrófono, de 0 a 1. */
  level: number
  /** Sin voz durante unos segundos: se avisa junto al botón. */
  silent?: boolean
  /** Ya hay un dictado en el cuadro: grabar de nuevo le agrega, no lo reemplaza. */
  adding?: boolean
  onStart: () => void
  onPause: () => void
  onResume: () => void
  onStop: () => void
}

export function recordingClock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

const BARS = 5

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="2.5" width="6" height="12" rx="3" fill="currentColor" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3.5" />
      <path d="M8.5 21.5h7" />
    </svg>
  )
}

function StopIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
      <rect x="5" y="5" width="14" height="14" rx="2" />
    </svg>
  )
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  )
}

function ResumeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
      <circle cx="12" cy="12" r="7" />
    </svg>
  )
}

function Spinner() {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="animate-spin motion-reduce:animate-none" aria-hidden="true">
      <path d="M12 3a9 9 0 1 0 9 9" />
    </svg>
  )
}

const pill = 'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-alphi-teal'

export function RecordButton({ state, seconds, level, silent = false, adding = false, onStart, onPause, onResume, onStop }: RecordButtonProps) {
  const lit = Math.round(Math.max(0, Math.min(1, level)) * BARS)

  if (state === 'idle' || state === 'busy') {
    const busy = state === 'busy'
    return (
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={onStart}
          disabled={busy}
          aria-label={busy ? 'Transcribiendo el dictado' : adding ? 'Grabar algo que faltó' : 'Grabar el dictado'}
          className="inline-flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-alphi-navy text-white shadow-alphi-panel transition-colors hover:bg-alphi-navydim focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-alphi-teal disabled:cursor-wait disabled:opacity-60"
        >
          {busy ? <Spinner /> : <MicIcon />}
        </button>
        <div className="min-w-0">
          <p className="text-base font-bold text-alphi-navy">{busy ? 'Transcribiendo…' : adding ? 'Agregar algo que faltó' : 'Grabar'}</p>
          <p className="text-xs text-alphi-muted">
            {busy
              ? 'El texto aparece abajo cuando termina.'
              : adding
                ? 'Nombrá el apartado y decí lo que falta: se suma a lo que ya está.'
                : 'Tocá el micrófono y hablá como en la consulta.'}
          </p>
        </div>
      </div>
    )
  }

  const paused = state === 'paused'
  return (
    <div className="space-y-3" role="group" aria-label="Grabación en curso">
      <p className={`flex flex-wrap items-center gap-3 text-base font-bold ${paused ? 'text-alphi-amber' : 'text-alphi-rose'}`}>
        <span className="relative inline-flex h-3 w-3">
          {paused ? null : <span className="absolute inset-0 rounded-full bg-alphi-rose opacity-60 animate-ping motion-reduce:hidden" aria-hidden="true" />}
          <span className={`relative inline-block h-3 w-3 rounded-full ${paused ? 'bg-alphi-amber' : 'bg-alphi-rose'}`} aria-hidden="true" />
        </span>
        <span>{paused ? 'En pausa' : 'Grabando'}</span>
        <span className="tabular-nums" role="timer" aria-live="off">
          {recordingClock(seconds)}
        </span>
        {paused ? null : (
          <span className="flex h-5 items-end gap-0.5" role="meter" aria-label="Nivel del micrófono" aria-valuemin={0} aria-valuemax={BARS} aria-valuenow={lit}>
            {Array.from({ length: BARS }, (_, index) => (
              <span key={index} className={`w-1.5 rounded-sm ${index < lit ? 'bg-alphi-rose' : 'bg-alphi-border'}`} style={{ height: `${40 + index * 15}%` }} />
            ))}
          </span>
        )}
      </p>
      <div className="flex flex-wrap gap-3">
        {paused ? (
          <button type="button" onClick={onResume} className={`${pill} bg-alphi-rose text-white hover:opacity-90`}>
            <ResumeIcon />
            Seguir grabando
          </button>
        ) : (
          <button type="button" onClick={onPause} className={`${pill} border border-alphi-border bg-white text-alphi-navy hover:bg-alphi-slate`}>
            <PauseIcon />
            Pausar
          </button>
        )}
        <button type="button" onClick={onStop} aria-label={`Terminar y transcribir (${recordingClock(seconds)})`} className={`${pill} bg-alphi-navy text-white hover:bg-alphi-navydim`}>
          <StopIcon />
          Terminar y transcribir
        </button>
      </div>
      {silent && !paused ? (
        <p className="text-xs font-semibold text-alphi-amber" role="alert">
          No llega voz al micrófono. Revisá que sea el correcto y que no esté silenciado.
        </p>
      ) : null}
    </div>
  )
}
