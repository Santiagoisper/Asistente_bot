import type { PatientProfile } from '@ichtys/clinical'

/**
 * El perfil tal como sale hacia la pantalla. **Toda ruta que responde con el perfil pasa por
 * acá** (lo vigila `profile-response.test.ts`).
 *
 * `retiredFacts` guarda lo que una persona retiró del perfil porque había entrado desde una
 * evolución registrada en el sujeto equivocado (D24). Son datos clínicos de otra persona: se
 * conservan, cifrados, como rastro de la corrección, pero no viajan. Lo único que sale es por
 * qué evoluciones ya se revisó el perfil y cuándo: alcanza para apagar el aviso de la ficha.
 */
export type ProfileForResponse = Omit<PatientProfile, 'retiredFacts'> & {
  retiredFrom?: Array<{ evolutionId: string; retiredAt: string }>
}

export function profileForResponse(profile: PatientProfile): ProfileForResponse {
  const { retiredFacts, ...rest } = profile
  if (!retiredFacts || retiredFacts.length === 0) return rest
  return { ...rest, retiredFrom: retiredFacts.map((entry) => ({ evolutionId: entry.evolutionId, retiredAt: entry.retiredAt })) }
}
