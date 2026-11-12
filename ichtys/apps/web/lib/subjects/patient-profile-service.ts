import {
  extractFactsFromEvolution,
  mergeExtractions,
  mergeProfileWithExtraction,
  parsePatientProfile,
  redactPhiForLlm,
  type PatientProfile,
  type PendingProfileProposal,
} from '@ichtys/clinical'
import { and, db, eq, getOrgLlmApiKeys, patientProfiles, recordUsage } from '@ichtys/db'
import { runWithLlmFallback } from '@ichtys/llm'
import { generateObject } from 'ai'
import { z } from 'zod'
import { insertAuditLog } from '../audit/audited-write'
import type { AuditLogParams } from '../chat/persistence'
import { labReviewMarker } from './lab-review-marker'
import { decryptProfileJson, encryptProfileJson } from './phi-fields'
import { nextVersion, whereProfileUnchanged, type ProfileScope } from './profile-version'

// Exportado para poder testear su tamaño (A7): cada campo extra infla el
// prompt del extractor clínico que corre sobre texto clínico real.
export const llmFactsSchema = z.object({
  ageYears: z.number().int().positive().nullable().optional(),
  systolic: z.number().int().positive().nullable().optional(),
  diastolic: z.number().int().positive().nullable().optional(),
  labs: z
    .array(
      z.object({
        name: z.string().min(1),
        value: z.number(),
        unit: z.string().optional(),
      }),
    )
    .default([]),
  medications: z
    .array(
      z.object({
        name: z.string().min(1),
        dose: z.string().optional(),
        frequency: z.string().optional(),
      }),
    )
    .default([]),
  conditions: z.array(z.string()).default([]),
})

function httpStatusFromError(err: object): number | null {
  for (const candidate of [(err as { status?: unknown }).status, (err as { statusCode?: unknown }).statusCode]) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate
  }
  return null
}

/**
 * Resumen seguro de un error de proveedor para logs: nombre de la clase y status
 * HTTP. Nunca el mensaje completo: los errores del SDK de IA repiten en el
 * mensaje el prompt enviado (PHI redactada, pero igual es texto clínico) o parte
 * de la respuesta del modelo.
 */
function summarizeLlmError(err: unknown): string {
  if (typeof err !== 'object' || err === null) return typeof err
  const name = err instanceof Error && err.name ? err.name : 'Error'
  const status = httpStatusFromError(err)
  return status === null ? name : `${name} (status ${status})`
}

async function extractFactsWithLlm(
  orgId: string,
  studyId: string,
  redactedContent: string,
): Promise<ReturnType<typeof extractFactsFromEvolution> | null> {
  const orgApiKeys = await getOrgLlmApiKeys(orgId).catch(() => null)

  try {
    const { result, provider, modelId, usage, keySource } = await runWithLlmFallback(
      { purpose: 'clinical-extract', orgApiKeys },
      async (model, _provider, reportUsage, signal) => {
        const response = await generateObject({
          model,
          abortSignal: signal,
          schema: llmFactsSchema,
          // Paso 1 (A7): mismo modo de salida que el medido (jsonTool) y
          // temperature explícita — ai 7 ya no manda 0 por defecto.
          providerOptions: { anthropic: { structuredOutputMode: 'jsonTool' } },
          temperature: 0,
          instructions: `Sos un extractor clínico para ensayos. Devolvé SOLO datos estructurados presentes en el texto.
No inventes valores. Si un dato no está explícito, omitilo o usá null.
Labs comunes: HbA1c (%), glucosa (mg/dL), creatinina, eGFR.
Medicaciones: nombre genérico, dosis y frecuencia si aparecen.`,
          prompt: redactedContent.slice(0, 8000),
          maxOutputTokens: 1024,
        })
        reportUsage({ inputTokens: response.usage?.inputTokens ?? 0, outputTokens: response.usage?.outputTokens ?? 0 })
        return response.object
      },
    )

    await recordUsage({
      orgId,
      studyId,
      userId: null,
      kind: 'clinical_extraction',
      provider,
      model: modelId,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      keySource: keySource === 'none' ? 'platform' : keySource,
    })

    return {
      ageYears: result.ageYears ?? undefined,
      systolic: result.systolic ?? undefined,
      diastolic: result.diastolic ?? undefined,
      labs: result.labs,
      medications: result.medications,
      conditions: result.conditions,
    }
  } catch (err) {
    console.error('[clinical-extract] LLM extraction failed:', summarizeLlmError(err))
    return null
  }
}

export async function loadPatientProfile(params: {
  orgId: string
  studyId: string
  subjectId: string
}): Promise<PatientProfile> {
  const row = await db.query.patientProfiles.findFirst({
    where: and(
      eq(patientProfiles.organizationId, params.orgId),
      eq(patientProfiles.studyId, params.studyId),
      eq(patientProfiles.subjectId, params.subjectId),
    ),
  })

  if (!row) return parsePatientProfile({})
  return parsePatientProfile(decryptProfileJson(row.profileEncrypted))
}

/** Otra persona estuvo escribiendo el mismo perfil y no se pudo aplicar el cambio. */
export class ProfileConflictError extends Error {
  constructor() {
    super('patient profile: concurrent update')
    this.name = 'ProfileConflictError'
  }
}

/** El sujeto no tiene fila de perfil: no hay dónde guardar. */
export class ProfileMissingError extends Error {
  constructor() {
    super('patient profile: missing row')
    this.name = 'ProfileMissingError'
  }
}

const MAX_PROFILE_WRITE_ATTEMPTS = 5

/**
 * Única forma de escribir el perfil del sujeto. Lee, aplica `mutate` y escribe
 * solo si nadie cambió la fila en el medio; si la cambiaron, vuelve a leer y
 * aplica `mutate` sobre lo nuevo. Así dos confirmaciones simultáneas no se
 * pisan. `mutate` puede correr más de una vez: tiene que depender solo del
 * perfil que recibe.
 */
/**
 * `audit` arma el registro del cambio a partir del perfil que se va a guardar.
 * Es obligatorio: el perfil guarda datos clínicos del sujeto y todo cambio deja
 * registro, en la misma transacción que la escritura (R3). El registro lleva
 * conteos e identificadores, nunca valores del perfil.
 */
export async function updatePatientProfile(
  params: ProfileScope,
  mutate: (current: PatientProfile) => PatientProfile | Promise<PatientProfile>,
  audit: (next: PatientProfile) => AuditLogParams,
): Promise<PatientProfile> {
  for (let attempt = 0; attempt < MAX_PROFILE_WRITE_ATTEMPTS; attempt += 1) {
    const row = await db.query.patientProfiles.findFirst({
      where: and(
        eq(patientProfiles.organizationId, params.orgId),
        eq(patientProfiles.studyId, params.studyId),
        eq(patientProfiles.subjectId, params.subjectId),
      ),
    })
    if (!row) throw new ProfileMissingError()

    const next = await mutate(parsePatientProfile(decryptProfileJson(row.profileEncrypted)))
    const written = await db.transaction(async (tx) => {
      const rows = await tx
        .update(patientProfiles)
        .set({
          profileEncrypted: encryptProfileJson(next as Record<string, unknown>),
          ...labReviewMarker(next),
          updatedAt: nextVersion(row.updatedAt),
        })
        .where(whereProfileUnchanged(params, row.updatedAt))
        .returning({ subjectId: patientProfiles.subjectId })
      // Solo quien de verdad escribió deja registro: un intento que perdió la
      // carrera no cambió nada.
      if (rows.length > 0) await insertAuditLog(tx, audit(next))
      return rows.length > 0
    })
    if (written) return next
  }
  throw new ProfileConflictError()
}

export type ProfileProposalErrorCode = 'no_pending_proposal'

export class ProfileProposalError extends Error {
  constructor(readonly code: ProfileProposalErrorCode) {
    super(`profile proposal: ${code}`)
    this.name = 'ProfileProposalError'
  }
}

type ProposalScope = ProfileScope & { evolutionId: string; userId: string }

function proposalFactCount(facts: PendingProfileProposal['facts']): number {
  return (
    (facts.ageYears ? 1 : 0) +
    (facts.systolic || facts.diastolic ? 1 : 0) +
    facts.labs.length +
    facts.medications.length +
    facts.conditions.length
  )
}

function proposalAudit(params: ProposalScope, action: AuditLogParams['action'], metadata: Record<string, unknown>): AuditLogParams {
  return {
    action,
    orgId: params.orgId,
    studyId: params.studyId,
    userId: params.userId,
    resourceType: 'subject',
    resourceId: params.subjectId,
    metadata: { source: 'evolution_extraction', evolutionId: params.evolutionId, ...metadata },
  }
}

/**
 * Lee una evolución (reglas + modelo) y deja lo que encontró como **propuesta**.
 * No toca los datos del perfil: eso lo hace una persona al aceptarla (R6).
 * Devuelve cuántos datos propuso; 0 significa que no había nada que revisar.
 */
export async function proposeProfileFromEvolution(
  params: ProposalScope & { evolutionContent: string },
): Promise<{ factCount: number }> {
  // La extracción (que puede llamar a un modelo) se hace una sola vez, fuera del reintento.
  const heuristic = extractFactsFromEvolution(params.evolutionContent, params.evolutionId)
  const { text: redacted } = redactPhiForLlm(params.evolutionContent)
  const llmFacts = await extractFactsWithLlm(params.orgId, params.studyId, redacted)
  const merged = mergeExtractions(heuristic, llmFacts)
  const proposal: PendingProfileProposal = {
    requiresHumanReview: true,
    evolutionId: params.evolutionId,
    extractedAt: new Date().toISOString(),
    facts: merged.facts,
    fieldConfidence: merged.fieldConfidence,
  }
  const factCount = proposalFactCount(proposal.facts)
  if (factCount === 0) return { factCount }

  await updatePatientProfile(
    params,
    (current) => ({
      ...current,
      pendingEvolutionProposals: [
        ...(current.pendingEvolutionProposals ?? []).filter((entry) => entry.evolutionId !== params.evolutionId),
        proposal,
      ],
    }),
    () => proposalAudit(params, 'profile.proposal.create', { automated: true, humanConfirmed: false, factCount }),
  )
  return { factCount }
}

function takeProposal(current: PatientProfile, evolutionId: string): { proposal: PendingProfileProposal; rest: PendingProfileProposal[] } {
  const pending = current.pendingEvolutionProposals ?? []
  const proposal = pending.find((entry) => entry.evolutionId === evolutionId)
  if (!proposal) throw new ProfileProposalError('no_pending_proposal')
  return { proposal, rest: pending.filter((entry) => entry.evolutionId !== evolutionId) }
}

function withProposals(profile: PatientProfile, rest: PendingProfileProposal[]): PatientProfile {
  const { pendingEvolutionProposals: _removed, ...base } = profile
  return rest.length > 0 ? { ...base, pendingEvolutionProposals: rest } : base
}

/** Una persona acepta la propuesta: recién ahí sus datos pasan al perfil. */
export async function confirmProfileProposal(params: ProposalScope): Promise<PatientProfile> {
  let factCount = 0
  return updatePatientProfile(
    params,
    (current) => {
      const { proposal, rest } = takeProposal(current, params.evolutionId)
      factCount = proposalFactCount(proposal.facts)
      const merged = mergeProfileWithExtraction(current, { facts: proposal.facts, fieldConfidence: proposal.fieldConfidence }, params.evolutionId)
      return withProposals(merged, rest)
    },
    () => proposalAudit(params, 'profile.update', { automated: false, humanConfirmed: true, factCount }),
  )
}

/** Una persona descarta la propuesta: el perfil queda como estaba. */
export async function rejectProfileProposal(params: ProposalScope): Promise<PatientProfile> {
  return updatePatientProfile(
    params,
    (current) => withProposals(current, takeProposal(current, params.evolutionId).rest),
    () => proposalAudit(params, 'profile.proposal.reject', { humanConfirmed: false }),
  )
}
