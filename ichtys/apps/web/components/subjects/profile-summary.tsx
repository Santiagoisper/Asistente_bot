import type { ReactNode } from 'react'
import { storedBloodPressureText } from '../../lib/subjects/voided-origin'

export type ProfileConfidenceLevel = 'high' | 'medium' | 'low'

export interface ProfileSummaryData {
  demographics?: { ageYears?: number }
  vitals?: { bloodPressureLabel?: string; systolic?: number; diastolic?: number }
  labs: Array<{ name: string; value: number; unit?: string }>
  medications: Array<{ name: string; dose?: string; frequency?: string }>
  conditions: string[]
  fieldConfidence?: {
    ageYears?: ProfileConfidenceLevel
    bloodPressure?: ProfileConfidenceLevel
    labs?: Record<string, ProfileConfidenceLevel>
    medications?: Record<string, ProfileConfidenceLevel>
    conditions?: Record<string, ProfileConfidenceLevel>
  }
}

const BLOCK = 'border-t border-alphi-border pt-3 first:border-t-0 first:pt-0'
const LABEL = 'text-xs font-bold uppercase tracking-wide text-alphi-navy'

function Block({ id, title, badge, children }: { id: string; title: string; badge?: ReactNode; children: ReactNode }) {
  return (
    <div data-block={id} className={BLOCK}>
      <dt className={LABEL}>
        {title}
        {badge}
      </dt>
      <dd className="mt-1 space-y-1">{children}</dd>
    </div>
  )
}

/**
 * El perfil extraído del sujeto, por bloques con su rótulo y un separador entre uno y otro.
 * El orden sigue el de las pestañas de la historia clínica del centro (Alpha CR, relevado el
 * 14/11/2026): edad, condiciones, medicamentos, laboratorios, signos vitales. Un bloque sin
 * datos no aparece.
 *
 * La presión que se muestra es la guardada en números, que es la que usa la elegibilidad; la
 * etiqueta puede haber quedado vieja si una propuesta trajo un solo valor.
 */
export function ProfileSummary({ profile, badge = () => null }: { profile: ProfileSummaryData; badge?: (level?: ProfileConfidenceLevel) => ReactNode }) {
  const fc = profile.fieldConfidence
  const pressure = storedBloodPressureText(profile.vitals)
  return (
    <dl className="space-y-3 text-sm text-alphi-navy">
      {profile.demographics?.ageYears ? (
        <Block id="edad" title="Edad" badge={badge(fc?.ageYears)}>
          <p>{profile.demographics.ageYears} años</p>
        </Block>
      ) : null}
      {profile.conditions.length > 0 ? (
        <Block id="condiciones" title="Condiciones">
          {profile.conditions.map((condition) => (
            <p key={condition}>
              {condition}
              {badge(fc?.conditions?.[condition.toLowerCase()])}
            </p>
          ))}
        </Block>
      ) : null}
      {profile.medications.length > 0 ? (
        <Block id="medicamentos" title="Medicamentos">
          {profile.medications.map((med) => (
            <p key={med.name}>
              {med.name}
              {med.dose ? ` ${med.dose}` : ''}
              {med.frequency ? ` — ${med.frequency}` : ''}
              {badge(fc?.medications?.[med.name.toLowerCase()])}
            </p>
          ))}
        </Block>
      ) : null}
      {profile.labs.length > 0 ? (
        <Block id="laboratorios" title="Laboratorios">
          {profile.labs.map((lab) => (
            <p key={lab.name}>
              {lab.name}: {lab.value}
              {lab.unit ? ` ${lab.unit}` : ''}
              {badge(fc?.labs?.[lab.name.toLowerCase()])}
            </p>
          ))}
        </Block>
      ) : null}
      {pressure ? (
        <Block id="presion" title="Presión arterial (TA)" badge={badge(fc?.bloodPressure)}>
          <p>{pressure} mmHg</p>
        </Block>
      ) : null}
    </dl>
  )
}
