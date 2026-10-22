import {
  extractFactsFromEvolution,
  mergeExtractions,
  mergeProfileWithExtraction,
  parsePatientProfile,
  redactPhiForLlm,
  type PatientProfile,
} from '@ichtys/clinical'
import { and, db, eq, getOrgLlmApiKeys, patientProfiles, recordUsage } from '@ichtys/db'
import { runWithLlmFallback } from '@ichtys/llm'
import { generateObject } from 'ai'
import { z } from 'zod'
import { decryptProfileJson, encryptProfileJson } from './phi-fields'

const llmFactsSchema = z.object({
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
          system: `Sos un extractor clínico para ensayos. Devolvé SOLO datos estructurados presentes en el texto.
No inventes valores. Si un dato no está explícito, omitilo o usá null.
Labs comunes: HbA1c (%), glucosa (mg/dL), creatinina, eGFR.
Medicaciones: nombre genérico, dosis y frecuencia si aparecen.`,
          prompt: redactedContent.slice(0, 8000),
          maxTokens: 1024,
        })
        reportUsage({ inputTokens: response.usage?.promptTokens ?? 0, outputTokens: response.usage?.completionTokens ?? 0 })
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

export async function persistPatientProfile(params: {
  orgId: string
  studyId: string
  subjectId: string
  profile: PatientProfile
}): Promise<void> {
  const profileEncrypted = encryptProfileJson(params.profile as Record<string, unknown>)

  await db
    .update(patientProfiles)
    .set({ profileEncrypted, updatedAt: new Date() })
    .where(
      and(
        eq(patientProfiles.organizationId, params.orgId),
        eq(patientProfiles.studyId, params.studyId),
        eq(patientProfiles.subjectId, params.subjectId),
      ),
    )
}

export async function refreshPatientProfileFromEvolution(params: {
  orgId: string
  studyId: string
  subjectId: string
  evolutionId: string
  evolutionContent: string
}): Promise<PatientProfile> {
  const current = await loadPatientProfile(params)

  const heuristic = extractFactsFromEvolution(params.evolutionContent, params.evolutionId)
  const { text: redacted } = redactPhiForLlm(params.evolutionContent)
  const llmFacts = await extractFactsWithLlm(params.orgId, params.studyId, redacted)
  const merged = mergeExtractions(heuristic, llmFacts)
  const profile = mergeProfileWithExtraction(current, merged, params.evolutionId)
  const profileEncrypted = encryptProfileJson(profile)

  await db
    .update(patientProfiles)
    .set({ profileEncrypted, updatedAt: new Date() })
    .where(
      and(
        eq(patientProfiles.organizationId, params.orgId),
        eq(patientProfiles.studyId, params.studyId),
        eq(patientProfiles.subjectId, params.subjectId),
      ),
    )

  return profile
}
