import { getLatestStudySpec } from '@ichtys/ingestion'
import { studySpecSchema } from '@ichtys/ingestion'
import type { StudySpec } from '@ichtys/ingestion'
import type { RetrievedChunk } from '@ichtys/rag'

/**
 * spec-context.ts — inyección de spec como contexto garantizado en el chat.
 *
 * El retrieval vectorial falla para preguntas de elegibilidad cuando:
 *  - El chunk de criterios es muy largo (20+ criterios mezclados)
 *  - La pregunta usa vocabulario distinto al del protocolo ("edad mínima" vs
 *    "18 años de edad o la edad legal...")
 *  - Hay chunks ruidosos de versiones anteriores compitiendo
 *
 * Solución: ALPHI ya extrajo el spec. Para preguntas sobre elegibilidad,
 * endpoints, visitas e identificación, inyectamos el spec directamente como
 * "virtual chunks" con similarityScore=1.0. Siempre pasan el threshold.
 *
 * Esto es el diferenciador ALPHI: conocimiento estructurado que los sistemas
 * RAG genéricos no tienen.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Intent detection (no LLM — heurística léxica, < 1ms)
// ─────────────────────────────────────────────────────────────────────────────

export type SpecSection = 'eligibility' | 'endpoints' | 'visits' | 'identification'

const INTENT_KEYWORDS: Record<SpecSection, string[]> = {
  eligibility: [
    'edad', 'años', 'criterio', 'inclus', 'exclus', 'elegib', 'participar',
    'particip', 'incluir', 'excluir', 'requisito', 'condición', 'elegible',
    'apto', 'selección', 'seleccion', 'inclusion', 'exclusion', 'eligible',
    'criteria', 'enroll', 'inscribir', 'inscripcion', 'reclut',
    'minimum age', 'age requirement', 'who can',
  ],
  endpoints: [
    'endpoint', 'objetivo', 'variable', 'eficacia', 'seguridad', 'primario',
    'secundario', 'exploratorio', 'outcome', 'medición', 'medicion',
    'resultado', 'evaluacion', 'primary', 'secondary', 'exploratory',
    'objective', 'valora', 'efficacy', 'safety endpoint',
  ],
  visits: [
    'visita', 'cronograma', ' soa', 'schedule', 'actividades', 'semana',
    ' día ', ' dia ', ' day ', 'procedimiento', 'evaluacion de visita',
    'calendario', 'follow', 'seguimiento', 'tiempo', 'duración', 'duracion',
    'screening', 'aleatori', 'randomiz',
  ],
  identification: [
    'título', 'titulo', 'nombre del estudio', 'protocol', 'fase', 'phase',
    'sponsor', 'patrocinador', 'ensayo', 'trial name', 'study title',
    'identificacion', 'identificación', 'código', 'codigo',
  ],
}

export function detectSpecIntent(question: string): SpecSection[] {
  const q = question.toLowerCase()
  const matched: SpecSection[] = []
  for (const [section, keywords] of Object.entries(INTENT_KEYWORDS) as [SpecSection, string[]][]) {
    if (keywords.some((kw) => q.includes(kw))) {
      matched.push(section)
    }
  }
  return matched
}

// ─────────────────────────────────────────────────────────────────────────────
// Formatters: spec → text legible para el LLM
// ─────────────────────────────────────────────────────────────────────────────

function formatEligibility(spec: StudySpec): string {
  const lines: string[] = []

  if (spec.inclusionCriteria.length > 0) {
    lines.push('CRITERIOS DE INCLUSIÓN:')
    for (const c of spec.inclusionCriteria) {
      lines.push(`${c.number}. ${c.text}`)
    }
  }

  if (spec.exclusionCriteria.length > 0) {
    if (lines.length > 0) lines.push('')
    lines.push('CRITERIOS DE EXCLUSIÓN:')
    for (const c of spec.exclusionCriteria) {
      lines.push(`${c.number}. ${c.text}`)
    }
  }

  return lines.join('\n')
}

function formatEndpoints(spec: StudySpec): string {
  if (spec.endpoints.length === 0) return ''
  const lines: string[] = ['OBJETIVOS Y CRITERIOS DE VALORACIÓN:']
  for (const ep of spec.endpoints) {
    lines.push(`[${ep.type.toUpperCase()}] Objetivo: ${ep.objective}`)
    lines.push(`  Criterio de valoración: ${ep.endpoint}`)
  }
  return lines.join('\n')
}

function formatVisits(spec: StudySpec): string {
  if (spec.visits.length === 0) return ''
  const lines: string[] = ['CRONOGRAMA DE ACTIVIDADES (VISITAS):']
  for (const v of spec.visits) {
    const dayStr = v.day !== null ? ` | Día ${v.day}` : ''
    const labelStr = v.label ? ` (${v.label})` : ''
    const windowStr = v.windowDays !== null ? ` ±${v.windowDays}d` : ''
    lines.push(`${v.name}${labelStr}${dayStr}${windowStr}`)
    if (v.procedures.length > 0) {
      lines.push(`  Procedimientos: ${v.procedures.join(', ')}`)
    }
  }
  return lines.join('\n')
}

function formatIdentification(spec: StudySpec): string {
  const lines: string[] = ['IDENTIFICACIÓN DEL PROTOCOLO:']
  if (spec.identification.title) lines.push(`Título: ${spec.identification.title}`)
  if (spec.identification.protocolCode) lines.push(`Código: ${spec.identification.protocolCode}`)
  if (spec.identification.phase) lines.push(`Fase: ${spec.identification.phase}`)
  return lines.join('\n')
}

const SECTION_FORMATTERS: Record<SpecSection, (spec: StudySpec) => string> = {
  eligibility: formatEligibility,
  endpoints: formatEndpoints,
  visits: formatVisits,
  identification: formatIdentification,
}

const SECTION_TITLES: Record<SpecSection, string> = {
  eligibility: 'Criterios de Elegibilidad (spec extraído del protocolo)',
  endpoints: 'Objetivos y Endpoints (spec extraído del protocolo)',
  visits: 'Cronograma de Visitas (spec extraído del protocolo)',
  identification: 'Identificación del Protocolo (spec extraído del protocolo)',
}

// ─────────────────────────────────────────────────────────────────────────────
// Virtual chunk factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convierte una sección del spec en un RetrievedChunk virtual.
 * similarityScore=1.0 garantiza que siempre pasa el threshold.
 */
function makeSpecChunk(
  section: SpecSection,
  content: string,
  spec: StudySpec,
  specId: string,
): RetrievedChunk {
  // Tomar las páginas fuente del primer item de la sección para el citation.
  let sourcePages: number[] = []
  if (section === 'eligibility') {
    sourcePages = [
      ...(spec.inclusionCriteria[0]?.sourcePages ?? []),
      ...(spec.exclusionCriteria[0]?.sourcePages ?? []),
    ]
  } else if (section === 'endpoints') {
    sourcePages = spec.endpoints[0]?.sourcePages ?? []
  } else if (section === 'visits') {
    sourcePages = spec.visits[0]?.sourcePages ?? []
  } else {
    sourcePages = spec.identification.sourcePages
  }

  const pageStart = Math.min(...sourcePages.filter((p) => p > 0)) || 1
  const pageEnd = Math.max(...sourcePages.filter((p) => p > 0)) || pageStart

  return {
    chunkId: `spec:${specId}:${section}`,
    documentId: `spec:${specId}`,
    documentVersionId: `spec:${specId}`,
    documentType: 'protocol',
    pageStart,
    pageEnd,
    sectionTitle: SECTION_TITLES[section],
    content,
    similarityScore: 1.0, // Siempre pasa el threshold — es conocimiento estructurado
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export interface SpecChunksResult {
  chunks: RetrievedChunk[]
  specFound: boolean
}

/**
 * Detecta el intent de la pregunta, carga el spec del estudio y retorna
 * virtual chunks con el contenido estructurado relevante.
 *
 * Los chunks retornados tienen similarityScore=1.0 y deben ser PREPENDED
 * al array de retrieved chunks (para que el LLM los vea como [1], [2], ...).
 *
 * No lanza — retorna { chunks: [], specFound: false } en caso de error.
 */
export async function getSpecContextChunks(params: {
  question: string
  orgId: string
  studyId: string
}): Promise<SpecChunksResult> {
  const intents = detectSpecIntent(params.question)

  // Sin intent claro → no inyectar spec (evitar contaminación)
  if (intents.length === 0) return { chunks: [], specFound: false }

  try {
    const specRow = await getLatestStudySpec({
      orgId: params.orgId,
      studyId: params.studyId,
    })

    if (!specRow) return { chunks: [], specFound: false }

    const parsed = studySpecSchema.safeParse(specRow.spec)
    if (!parsed.success) return { chunks: [], specFound: false }

    const spec = parsed.data
    const specId = specRow.id
    const chunks: RetrievedChunk[] = []

    for (const section of intents) {
      const content = SECTION_FORMATTERS[section](spec)
      if (content.trim().length === 0) continue
      chunks.push(makeSpecChunk(section, content, spec, specId))
    }

    return { chunks, specFound: true }
  } catch (err) {
    console.warn('[spec-context] Failed to load spec for context injection:', err)
    return { chunks: [], specFound: false }
  }
}
