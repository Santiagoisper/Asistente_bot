'use client'

import { useState } from 'react'
import { hasSubjectCode } from './recording-notice'

/** Lo que la persona confirmó: el sujeto que nombraba el botón, y el motivo si lo escribió. */
export interface VoidConfirmation {
  confirmedSubjectCode: string
  note?: string
}

/** Lo que se le dice a la persona después de un intento, salga o no. */
export interface VoidFeedback {
  kind: 'done' | 'error'
  text: string
}

interface Props {
  subjectCode: string
  /** Cómo nombrar la evolución en el texto, por ejemplo «la evolución del 14/11/2026». */
  evolutionLabel: string
  /** La evolución ya figura como registrada por error: no hay nada que declarar. */
  voided: boolean
  /** La historia dice que a esta persona se le ofrece la acción en esta evolución. Decide la ruta. */
  allowed: boolean
  open: boolean
  busy: boolean
  feedback: VoidFeedback | null
  onOpen: () => void
  onCancel: () => void
  onConfirm: (confirmation: VoidConfirmation) => void
}

const NOTE_MAX = 500

/**
 * Declarar, desde la historia, que una evolución se registró en el sujeto equivocado
 * (docs/decisions/grabacion-en-sujeto-equivocado.md, D24, punto 1).
 *
 * Es definitivo. Por eso el botón que confirma repite el código del sujeto, como el aviso de
 * antes de grabar (D23): confirmar es afirmar «esto no es de este sujeto», y lo que viaja es el
 * código que el botón nombraba al tocarlo. Alphi no lo declara solo.
 */
export function EvolutionVoidControl(props: Props) {
  const { feedback } = props
  if (props.voided || !props.allowed) {
    // Lo que pasó se sigue diciendo aunque ya no haya nada que declarar.
    return feedback ? <FeedbackLine feedback={feedback} /> : null
  }
  if (!props.open) {
    return (
      <div className="mt-2 space-y-2">
        {feedback ? <FeedbackLine feedback={feedback} /> : null}
        <button
          type="button"
          onClick={props.onOpen}
          disabled={props.busy}
          className="text-xs font-semibold text-alphi-muted underline underline-offset-2 hover:text-alphi-navy disabled:cursor-not-allowed disabled:opacity-40"
        >
          Se registró en el sujeto equivocado
        </button>
      </div>
    )
  }
  return <VoidForm {...props} />
}

function FeedbackLine({ feedback }: { feedback: VoidFeedback }) {
  return feedback.kind === 'error' ? (
    <p role="alert" className="mt-2 rounded-lg border border-alphi-rose/30 bg-alphi-rose/10 px-3 py-2 text-sm text-alphi-rose">
      {feedback.text}
    </p>
  ) : (
    <p role="status" className="mt-2 rounded-lg border border-alphi-border bg-alphi-slate px-3 py-2 text-sm text-alphi-navy">
      {feedback.text}
    </p>
  )
}

/** El diálogo abierto. Se monta al abrir: cerrarlo descarta el motivo que se había escrito. */
function VoidForm(props: Props) {
  const [note, setNote] = useState('')
  const ready = hasSubjectCode(props.subjectCode)
  const code = props.subjectCode.trim()

  function confirm() {
    if (!ready || props.busy) return
    const trimmed = note.trim()
    props.onConfirm({ confirmedSubjectCode: code, ...(trimmed ? { note: trimmed } : {}) })
  }

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-alphi-border bg-alphi-slate p-3 text-sm text-alphi-navy" role="group" aria-label="Declarar que se registró en el sujeto equivocado">
      {ready ? (
        <p className="font-semibold">
          Vas a declarar que {props.evolutionLabel} no es del sujeto <span className="font-mono">{code}</span>: se registró acá por error.
        </p>
      ) : (
        <p className="font-semibold">Esperá a que cargue el sujeto antes de declarar.</p>
      )}
      <ul className="list-disc space-y-1 pl-5">
        <li>La evolución queda en la historia con la marca «Registrada por error en este sujeto» y el texto original plegado. No se borra.</li>
        <li>
          Sus grabaciones, si tiene, salen de este sujeto y pasan a las grabaciones sin sujeto. Quien las grabó las sigue pudiendo escuchar desde ahí
          hasta que venzan; por ahora, nadie más.
        </li>
        <li>Si Alphi tenía una propuesta pendiente para el perfil a partir de esta evolución, se retira.</li>
        <li>El perfil no se corrige solo. Si de esta evolución ya se había aceptado algo, la ficha lo avisa para que lo revises.</li>
      </ul>
      <p>
        <strong>No tiene vuelta atrás.</strong> Si lo declarás por error, se aclara con una evolución nueva que lo diga.
      </p>
      <label className="block space-y-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-alphi-muted">Motivo (opcional)</span>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={NOTE_MAX}
          rows={2}
          disabled={props.busy}
          className="w-full rounded-lg border border-alphi-border bg-white px-3 py-2 text-sm"
        />
        <span className="block text-xs text-alphi-muted">Queda guardado, cifrado, junto a la declaración.</span>
      </label>
      {props.feedback?.kind === 'error' ? <FeedbackLine feedback={props.feedback} /> : null}
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={confirm} disabled={!ready || props.busy} className="alphi-btn-primary disabled:opacity-40">
          {ready ? `Sí, no es de ${code}: declarar el error` : 'Cargando el sujeto…'}
        </button>
        <button type="button" onClick={props.onCancel} disabled={props.busy} className="alphi-btn-secondary">
          Cancelar
        </button>
      </div>
    </div>
  )
}
