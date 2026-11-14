'use client'

import { useState, type FormEvent } from 'react'

/**
 * Lo que la persona eligió retirar del perfil. Los laboratorios de la evolución anulada no
 * figuran: salen siempre, y los resuelve el servidor por su origen.
 */
export interface RetireChoice {
  removeAge: boolean
  removeBloodPressure: boolean
  medications: string[]
  conditions: string[]
  nothingToRetire: boolean
}

interface Props {
  subjectCode: string
  /** Cómo nombrar la evolución en el texto, por ejemplo «la evolución del 14/11/2026». */
  evolutionLabel: string
  /** Laboratorios del perfil que vinieron de esa evolución. */
  labNames: string[]
  ageYears?: number
  bloodPressure?: string
  medications: string[]
  conditions: string[]
  busy: boolean
  error: string | null
  onSubmit: (choice: RetireChoice) => void
  onCancel: () => void
}

const BOX = 'mt-0.5 h-4 w-4 shrink-0 accent-[#0B7A6E]'
const ROW = 'flex items-start gap-2 text-sm text-alphi-navy'

/**
 * Formulario para retirar del perfil lo que entró desde una evolución registrada por error en
 * este sujeto (D24, punto 4 bis). Alphi lista y no marca nada: lo decide la persona. Lo único
 * que sale sin elegir son los laboratorios de esa evolución, porque guardan su origen.
 */
export function VoidedOriginReviewForm(props: Props) {
  const [removeAge, setRemoveAge] = useState(false)
  const [removeBloodPressure, setRemoveBloodPressure] = useState(false)
  const [medications, setMedications] = useState<string[]>([])
  const [conditions, setConditions] = useState<string[]>([])
  const [nothing, setNothing] = useState(false)

  // Lo marcado vale solo si sigue en el perfil: la lista puede cambiar mientras la persona elige.
  const pickedMedications = medications.filter((name) => props.medications.includes(name))
  const pickedConditions = conditions.filter((name) => props.conditions.includes(name))
  const pickedAge = removeAge && props.ageYears !== undefined
  const pickedPressure = removeBloodPressure && props.bloodPressure !== undefined
  const somethingPicked = pickedAge || pickedPressure || pickedMedications.length > 0 || pickedConditions.length > 0
  const hasLabs = props.labNames.length > 0
  // «No hay nada» solo se puede declarar cuando de verdad no sale nada.
  const canDeclareNothing = !hasLabs && !somethingPicked
  // La declaración vale solo mientras la casilla está a la vista. Si deja de ofrecerse (la persona
  // eligió algo, o apareció un laboratorio de ese origen), se borra: cuando la casilla vuelva,
  // vuelve sin marcar. Nada se manda con una marca que la persona no puso en ese momento.
  if (nothing && !canDeclareNothing) setNothing(false)
  const nothingToRetire = canDeclareNothing && nothing
  const canSubmit = !props.busy && (hasLabs || somethingPicked || nothingToRetire)

  const toggle = (list: string[], set: (next: string[]) => void, name: string) =>
    set(list.includes(name) ? list.filter((entry) => entry !== name) : [...list, name])

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!canSubmit) return
    props.onSubmit({ removeAge: pickedAge, removeBloodPressure: pickedPressure, medications: pickedMedications, conditions: pickedConditions, nothingToRetire })
  }

  return (
    <form onSubmit={submit} className="mt-3 space-y-3 rounded-lg border border-alphi-border bg-white p-3">
      <p className="text-sm text-alphi-navy">
        Vas a revisar el perfil de <strong>{props.subjectCode}</strong> por {props.evolutionLabel}, que se registró por error en este sujeto. Marcá lo que
        vino de esa evolución. Alphi no marca nada por vos.
      </p>

      {hasLabs ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-alphi-muted">Laboratorios de esa evolución: salen siempre</p>
          <p className="mt-1 text-sm text-alphi-navy">{props.labNames.join(', ')}</p>
          <p className="mt-1 text-xs text-alphi-muted">El valor anterior de cada uno no quedó guardado: se vuelve a cargar desde el informe.</p>
        </div>
      ) : null}

      {props.ageYears !== undefined || props.bloodPressure !== undefined ? (
        <fieldset className="space-y-1">
          <legend className="text-xs font-semibold uppercase tracking-wide text-alphi-muted">Edad y presión arterial</legend>
          {props.ageYears !== undefined ? (
            <label className={ROW}>
              <input type="checkbox" className={BOX} checked={removeAge} disabled={props.busy} onChange={(event) => setRemoveAge(event.target.checked)} />
              <span>Edad: {props.ageYears} años</span>
            </label>
          ) : null}
          {props.bloodPressure !== undefined ? (
            <label className={ROW}>
              <input type="checkbox" className={BOX} checked={removeBloodPressure} disabled={props.busy} onChange={(event) => setRemoveBloodPressure(event.target.checked)} />
              <span>Presión arterial: {props.bloodPressure}</span>
            </label>
          ) : null}
          <p className="text-xs text-alphi-muted">Si las sacás quedan vacías: el valor anterior no quedó guardado.</p>
        </fieldset>
      ) : null}

      {props.medications.length > 0 ? (
        <fieldset className="space-y-1">
          <legend className="text-xs font-semibold uppercase tracking-wide text-alphi-muted">Medicaciones</legend>
          {props.medications.map((name) => (
            <label key={name} className={ROW}>
              <input type="checkbox" className={BOX} checked={medications.includes(name)} disabled={props.busy} onChange={() => toggle(medications, setMedications, name)} />
              <span>{name}</span>
            </label>
          ))}
        </fieldset>
      ) : null}

      {props.conditions.length > 0 ? (
        <fieldset className="space-y-1">
          <legend className="text-xs font-semibold uppercase tracking-wide text-alphi-muted">Condiciones</legend>
          {props.conditions.map((name) => (
            <label key={name} className={ROW}>
              <input type="checkbox" className={BOX} checked={conditions.includes(name)} disabled={props.busy} onChange={() => toggle(conditions, setConditions, name)} />
              <span>{name}</span>
            </label>
          ))}
        </fieldset>
      ) : null}

      {canDeclareNothing ? (
        <label className={`${ROW} border-t border-alphi-border pt-3`}>
          <input type="checkbox" className={BOX} checked={nothing} disabled={props.busy} onChange={(event) => setNothing(event.target.checked)} />
          <span>Revisé el perfil y no hay nada de esa evolución.</span>
        </label>
      ) : null}

      <p className="text-xs text-alphi-muted">Lo que sale no se borra: queda guardado, cifrado, con tu nombre y la fecha. No vuelve a mostrarse en la ficha.</p>

      {props.error ? (
        <p role="alert" className="rounded-lg border border-alphi-rose/30 bg-alphi-rose/10 px-3 py-2 text-sm text-alphi-rose">
          {props.error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={!canSubmit} className="alphi-btn-primary text-sm">
          {nothingToRetire ? `Confirmar la revisión de ${props.subjectCode}` : `Retirar del perfil de ${props.subjectCode}`}
        </button>
        <button type="button" onClick={props.onCancel} disabled={props.busy} className="alphi-btn-ghost text-sm">
          Cancelar
        </button>
      </div>
    </form>
  )
}
