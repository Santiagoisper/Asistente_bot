import { validateStudyAccess } from '@ichtys/auth'
import { getLatestStudySpec, studySpecSchema, isMeaningfulSpec } from '@ichtys/ingestion'
import { and, db, documents, eq } from '@ichtys/db'

export const dynamic = 'force-dynamic'
import { annotateAnswerSync } from '@ichtys/rag/medical-annotator'
import SpecReview from '../../../../../components/spec/spec-review'
import { SpecReextractButton } from '../../../../../components/spec/spec-reextract-button'
import { SpecAutoRefresh } from '../../../../../components/spec/spec-auto-refresh'
import {
  hasLegacyExtractionFailure,
  isProtocolProcessing,
  resolveExtractionFailed,
  specExtractionWarnings,
  specHasExtractionFailed,
} from '../../../../../lib/spec-extraction-status'
import type { EligibilityCriterion } from '@ichtys/ingestion'
import type { MedicalAnnotation } from '@ichtys/rag/medical-annotator'

interface SpecPageProps {
  params: Promise<{ id: string }>
}

export type AnnotatedCriterion = EligibilityCriterion & {
  /** SNOMED-CT / LOINC annotations detected in criterion text. < 2 ms, no I/O. */
  annotations: MedicalAnnotation[]
}

/**
 * Annotates every criterion with SNOMED-CT / LOINC codes at read time.
 * Annotations are deterministic from the text, so we don't persist them —
 * computing them here avoids a circular dependency between @ichtys/ingestion
 * and @ichtys/rag.
 */
function annotateCriteria(criteria: EligibilityCriterion[]): AnnotatedCriterion[] {
  return criteria.map((c) => ({
    ...c,
    annotations: annotateAnswerSync(c.text),
  }))
}

export default async function StudySpecPage({ params }: SpecPageProps) {
  const { id: studyId } = await params
  const { orgId } = await validateStudyAccess(studyId)

  const [row, protocolDocsWithLatestVersion] = await Promise.all([
    getLatestStudySpec({ orgId, studyId }),
    // Solo la ÚLTIMA versión de cada documento 'protocol' — no todas las
    // versiones históricas. Si no, un fallo viejo (ya resuelto por una
    // re-subida) deja el banner de error pegado para siempre.
    db.query.documents.findMany({
      where: and(
        eq(documents.studyId, studyId),
        eq(documents.organizationId, orgId),
        eq(documents.documentType, 'protocol'),
      ),
      with: {
        versions: {
          columns: { status: true, errorMessage: true },
          orderBy: (v, { desc }) => [desc(v.createdAt)],
          limit: 1,
        },
      },
    }),
  ])

  const latestProtocolVersions = protocolDocsWithLatestVersion
    .map((d) => d.versions[0])
    .filter((v): v is NonNullable<typeof v> => v !== undefined)

  const protocolProcessing = isProtocolProcessing(latestProtocolVersions)
  // Legado: antes de que el spec guardara su propio extractionFailed, un
  // fallo de extracción dejaba el document_version entero en 'error'. Solo
  // importa cuando no hay spec guardado — si lo hay, manda su propio campo.
  const legacyExtractionFailed = hasLegacyExtractionFailure(latestProtocolVersions)

  const parsedPreview = row ? studySpecSchema.safeParse(row.spec) : null
  const specExtractionFailedPreview =
    parsedPreview?.success ? specHasExtractionFailed(parsedPreview.data) : false
  const meaningfulPreview =
    parsedPreview?.success ? isMeaningfulSpec(parsedPreview.data) : false
  const extractionFailed = resolveExtractionFailed({
    protocolProcessing,
    specExtractionFailed: row ? specExtractionFailedPreview : false,
    legacyExtractionFailed: row ? false : legacyExtractionFailed,
  })
  const pollForSpec = protocolProcessing || (!meaningfulPreview && !extractionFailed)

  if (!row) {
    return (
      <div className="space-y-4 py-8">
        <SpecAutoRefresh
          studyId={studyId}
          enabled={pollForSpec}
          initialVersion={null}
          initialMeaningful={false}
        />
        {extractionFailed ? (
          <div className="rounded-xl border border-alphi-rose/30 bg-alphi-rose/5 px-4 py-6 text-center">
            <p className="text-sm font-semibold text-alphi-navy">
              No se pudo extraer el cronograma ni los criterios
            </p>
            <p className="mt-2 text-sm text-alphi-muted">
              El protocolo se indexó para el chat, pero la extracción automática del spec
              falló. Podés reintentarla desde acá.
            </p>
            <div className="mt-4">
              <SpecReextractButton studyId={studyId} />
            </div>
          </div>
        ) : (
          <div className="py-8 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-alphi-teallit">
              <span className="text-2xl">🔬</span>
            </div>
            <p className="text-sm font-semibold text-alphi-navy">
              {protocolProcessing ? 'Extrayendo spec del protocolo…' : 'Sin spec extraído todavía'}
            </p>
            <p className="mt-1 text-sm text-alphi-muted">
              {protocolProcessing
                ? 'ALPHI está indexando el PDF. Los criterios aparecerán acá automáticamente.'
                : 'Subí un protocolo y ALPHI extraerá automáticamente los criterios, endpoints y visitas.'}
            </p>
          </div>
        )}
      </div>
    )
  }

  const parsed = studySpecSchema.safeParse(row.spec)
  if (!parsed.success) {
    return (
      <div className="rounded-xl border border-alphi-rose/30 bg-alphi-rose/5 px-4 py-6 text-center">
        <p className="text-sm font-semibold text-alphi-navy">Spec corrupto en base de datos</p>
        <p className="mt-2 text-sm text-alphi-muted">
          La versión v{row.version} no cumple el schema actual. Podés re-extraer el spec desde el protocolo indexado.
        </p>
        <div className="mt-4">
          <SpecReextractButton studyId={studyId} />
        </div>
      </div>
    )
  }

  const spec = parsed.data
  const meaningful = isMeaningfulSpec(spec)
  const extractionWarnings = specExtractionWarnings(spec)

  // Annotate criteria with SNOMED-CT / LOINC — deterministic, < 2 ms total
  const annotatedInclusion = annotateCriteria(spec.inclusionCriteria)
  const annotatedExclusion = annotateCriteria(spec.exclusionCriteria)

  return (
    <div className="space-y-4">
      <SpecAutoRefresh
        studyId={studyId}
        enabled={pollForSpec}
        initialVersion={row.version}
        initialMeaningful={meaningful}
      />
      {extractionFailed ? (
        <div className="rounded-xl border border-alphi-rose/30 bg-alphi-rose/5 px-4 py-3 text-sm text-alphi-navy">
          <p className="font-semibold">No se pudo extraer el cronograma ni los criterios</p>
          <p className="mt-1 text-alphi-muted">
            El protocolo está indexado para el chat, pero la extracción automática del spec
            falló{extractionWarnings.length > 0 ? ':' : '.'}
          </p>
          {extractionWarnings.length > 0 && (
            <ul className="mt-2 list-disc space-y-0.5 pl-5 text-alphi-muted">
              {extractionWarnings.map((w, i) => (
                <li key={i} className="break-words">{w}</li>
              ))}
            </ul>
          )}
          <div className="mt-3">
            <SpecReextractButton studyId={studyId} />
          </div>
        </div>
      ) : !meaningful ? (
        <div className="rounded-xl border border-alphi-amber/40 bg-alphi-amber/10 px-4 py-3 text-sm text-alphi-navy">
          <p className="font-semibold">Spec parcial — solo identificación del protocolo</p>
          <p className="mt-1 text-alphi-muted">
            ALPHI extrajo el código y título, pero no los criterios, endpoints ni visitas.
            El documento sí está indexado para el chat. Podés re-intentar la extracción del spec.
          </p>
          <div className="mt-3">
            <SpecReextractButton studyId={studyId} />
          </div>
        </div>
      ) : extractionWarnings.length > 0 ? (
        <div className="rounded-xl border border-alphi-amber/40 bg-alphi-amber/10 px-4 py-3 text-sm text-alphi-navy">
          <p className="font-semibold">La extracción tuvo advertencias</p>
          <p className="mt-1 text-alphi-muted">
            Parte del spec pudo no haberse extraído con precisión. Revisá estos puntos antes
            de aprobar:
          </p>
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-alphi-muted">
            {extractionWarnings.map((w, i) => (
              <li key={i} className="break-words">{w}</li>
            ))}
          </ul>
          <div className="mt-3">
            <SpecReextractButton studyId={studyId} />
          </div>
        </div>
      ) : null}
      <SpecReview
        specId={row.id}
        studyId={studyId}
        version={row.version}
        status={row.status as 'draft' | 'approved' | 'superseded'}
        extractionModel={row.extractionModel}
        createdAt={row.createdAt.toISOString()}
        spec={spec}
        annotatedInclusion={annotatedInclusion}
        annotatedExclusion={annotatedExclusion}
        previousApprovedSpecId={row.previousApprovedSpecId ?? null}
      />
    </div>
  )
}
