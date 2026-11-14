'use client'

/**
 * El aviso que se acepta antes de grabar o de subir un audio (docs/decisions/consulta-dictada.md,
 * D8 y D23). Nombra al sujeto: la grabación y la evolución quedan atadas a él, y un audio
 * guardado en el sujeto equivocado deja también el texto en el sujeto equivocado. El botón
 * que sigue repite el código para que aceptar sea afirmar «es este».
 */
export interface RecordingNoticeProps {
  subjectCode: string
  retentionDays: number
  /** Qué sigue al aceptar: grabar con el micrófono o elegir un archivo de audio. */
  action: 'record' | 'upload'
  onAccept: () => void
  onCancel: () => void
}

/** `true` si el código del sujeto ya está a la vista: sin él no hay nada que confirmar. */
export function hasSubjectCode(subjectCode: string): boolean {
  const code = subjectCode.trim()
  return code !== '' && code !== '…'
}

export function RecordingNotice({ subjectCode, retentionDays, action, onAccept, onCancel }: RecordingNoticeProps) {
  const ready = hasSubjectCode(subjectCode)
  const code = subjectCode.trim()
  return (
    <div className="space-y-2 rounded-lg border border-alphi-border bg-alphi-slate p-3 text-sm" role="group" aria-label="Antes de grabar">
      {ready ? (
        <p className="font-semibold text-alphi-navy">
          {action === 'record' ? 'Vas a grabar en el sujeto ' : 'El audio que subas va a quedar en el sujeto '}
          <span className="font-mono">{code}</span>. Si no es el sujeto de esta consulta, no sigas.
        </p>
      ) : (
        <p className="font-semibold text-alphi-navy">Esperá a que cargue el sujeto antes de grabar.</p>
      )}
      <p>
        Se graba <strong>tu dictado</strong> para armar un borrador. El audio se transcribe en este equipo. Si guardás la
        evolución, la grabación se guarda cifrada junto a ella durante {retentionDays} días y después se borra; si
        descartás el dictado, no se guarda nada. Grabar a un paciente exige su consentimiento.
      </p>
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={onAccept} disabled={!ready} className="alphi-btn-primary disabled:opacity-40">
          {ready ? `Es ${code}, ${action === 'record' ? 'empezar a grabar' : 'elegir el audio'}` : 'Cargando el sujeto…'}
        </button>
        <button type="button" onClick={onCancel} className="alphi-btn-secondary">
          No es este sujeto
        </button>
      </div>
    </div>
  )
}
