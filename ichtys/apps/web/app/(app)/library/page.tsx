import { auth, clerkClient } from '@clerk/nextjs/server'
import { db, eq, organizations, studies, documentVersions, studySpecs } from '@ichtys/db'
import { studySpecSchema, isMeaningfulSpec } from '@ichtys/ingestion'
import { extractSpecTerminology, parseTerminologyAnnotations, readLegacySpecTerminology } from '../../../lib/rag/spec-terminology'
import { LibraryClient, type LibraryRow } from '../../../components/library/library-client'

async function resolveOrProvisionOrg(clerkOrgId: string) {
  const existing = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  })
  if (existing) return existing

  let orgName = clerkOrgId
  try {
    const client = await clerkClient()
    const clerkOrg = await client.organizations.getOrganization({ organizationId: clerkOrgId })
    orgName = clerkOrg.name || clerkOrgId
  } catch {
    // Non-critical fallback
  }

  const [provisioned] = await db
    .insert(organizations)
    .values({ clerkOrgId, name: orgName })
    .returning()

  return provisioned ?? null
}

export default async function LibraryPage() {
  const { orgId: clerkOrgId } = await auth()
  let rows: LibraryRow[] = []

  if (clerkOrgId) {
    const org = await resolveOrProvisionOrg(clerkOrgId)
    if (org) {
      const [studyList, versions, specs] = await Promise.all([
        db.query.studies.findMany({
          where: eq(studies.organizationId, org.id),
          orderBy: (s, ops) => [ops.desc(s.createdAt)],
        }),
        db.query.documentVersions.findMany({
          where: eq(documentVersions.organizationId, org.id),
        }),
        db.query.studySpecs.findMany({
          where: eq(studySpecs.organizationId, org.id),
          orderBy: (sp, ops) => [ops.desc(sp.version)],
        }),
      ])

      // Conteo de documentos indexados (versiones 'ready') por estudio.
      const readyByStudy = new Map<string, number>()
      for (const v of versions) {
        if (v.status === 'ready') {
          readyByStudy.set(v.studyId, (readyByStudy.get(v.studyId) ?? 0) + 1)
        }
      }

      // Spec de mayor versión con contenido útil por estudio.
      const specsByStudy = new Map<string, (typeof specs)[number][]>()
      for (const sp of specs) {
        const list = specsByStudy.get(sp.studyId) ?? []
        list.push(sp)
        specsByStudy.set(sp.studyId, list)
      }

      rows = studyList.map((study) => {
        const studySpecsList = specsByStudy.get(study.id) ?? []
        studySpecsList.sort((a, b) => b.version - a.version)
        let spec: (typeof specs)[number] | undefined
        for (const sp of studySpecsList) {
          const parsed = studySpecSchema.safeParse(sp.spec)
          if (parsed.success && isMeaningfulSpec(parsed.data)) {
            spec = sp
            break
          }
        }
        spec ??= studySpecsList[0]
        const parsed = spec ? studySpecSchema.safeParse(spec.spec) : null
        const data = parsed?.success ? parsed.data : null

        // Terminología: columna dedicada → legacy jsonb → on-demand.
        const terminology =
          (spec ? parseTerminologyAnnotations(spec.terminologyAnnotations) : null) ??
          (spec ? readLegacySpecTerminology(spec.spec) : null) ??
          (data ? extractSpecTerminology(data) : [])

        return {
          studyId: study.id,
          name: study.name,
          protocolCode: data?.identification.protocolCode ?? study.protocolNumber ?? null,
          title: data?.identification.title ?? null,
          phase: data?.identification.phase ?? null,
          specStatus: spec ? (spec.status as 'draft' | 'approved' | 'superseded') : null,
          indexedDocs: readyByStudy.get(study.id) ?? 0,
          inclusionCount: data?.inclusionCriteria.length ?? 0,
          exclusionCount: data?.exclusionCriteria.length ?? 0,
          endpointCount: data?.endpoints.length ?? 0,
          visitCount: data?.visits.length ?? 0,
          terminology: terminology.map((t) => ({ system: t.system, code: t.code, display: t.display })),
          createdAt: study.createdAt.toISOString(),
          specPartial: spec ? (parsed?.success ? !isMeaningfulSpec(parsed.data) : true) : false,
        }
      })
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="alphi-label mb-1">Librería de protocolos</p>
          <h1 className="text-2xl font-bold text-alphi-navy">Protocolos de la organización</h1>
          <p className="mt-1 text-sm text-alphi-muted">
            {rows.length} protocolo{rows.length !== 1 ? 's' : ''} &middot; todo lo extraído de cada uno en un solo lugar.
          </p>
        </div>
      </div>

      <LibraryClient rows={rows} />
    </div>
  )
}
