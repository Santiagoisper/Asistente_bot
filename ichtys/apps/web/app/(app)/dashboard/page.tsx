import Link from 'next/link'
import { auth } from '@clerk/nextjs/server'
import { db, eq, organizations, studies, documents } from '@ichtys/db'

async function getDashboardData(clerkOrgId: string, userId: string) {
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  })
  if (!org) return { studyList: [] as typeof studyRows, recentConversations: [] as typeof convRows, docCount: 0 }

  const studyRows = await db.query.studies.findMany({
    where: eq(studies.organizationId, org.id),
    orderBy: (s, ops) => [ops.desc(s.createdAt)],
    limit: 6,
  })

  const convRows = await db.query.conversations.findMany({
    where: (c, ops) => ops.and(ops.eq(c.organizationId, org.id), ops.eq(c.userId, userId)),
    orderBy: (c, ops) => [ops.desc(c.updatedAt)],
    limit: 5,
  })

  const allDocs = await db.query.documents.findMany({
    where: eq(documents.organizationId, org.id),
  })

  return { studyList: studyRows, recentConversations: convRows, docCount: allDocs.length }
}

function formatRelative(date: Date): string {
  const diff = Date.now() - date.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'ahora mismo'
  if (mins < 60) return `hace ${mins} min`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `hace ${hrs}h`
  const days = Math.floor(hrs / 24)
  if (days === 1) return 'ayer'
  return `hace ${days} dias`
}

export default async function DashboardPage() {
  const { orgId: clerkOrgId, userId } = await auth()

  const data = (clerkOrgId && userId)
    ? await getDashboardData(clerkOrgId, userId)
    : { studyList: [], recentConversations: [], docCount: 0 }

  const { studyList, recentConversations, docCount } = data
  const activeStudies = studyList.filter((s) => s.status === 'active').length

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="rounded-xl bg-alphi-navy px-6 py-5 shadow-alphi-panel">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-alphi-teal">
              ALPHI - Clinical Document Intelligence
            </p>
            <h1 className="text-2xl font-bold text-white">Bienvenido de vuelta</h1>
            <p className="mt-1 text-sm text-white/60">
              Consulta protocolos, manuales y SOPs con citas exactas al documento fuente.
            </p>
          </div>
          <div className="hidden shrink-0 gap-6 md:flex">
            <DashStat value={activeStudies} label="Estudios activos" />
            <DashStat value={docCount} label="Docs indexados" />
            <DashStat value={recentConversations.length} label="Consultas recientes" />
          </div>
        </div>
      </div>

      <div className="flex items-start gap-3 rounded-xl border border-alphi-teal/20 bg-alphi-teal/5 px-4 py-3">
        <p className="text-sm leading-relaxed text-alphi-navy/80">
          <strong className="font-semibold text-alphi-navy">Recordatorio GCP:</strong>{' '}
          ALPHI responde exclusivamente desde documentos cargados. Ante cualquier duda clinica
          o de seguridad, consultar siempre la version vigente del protocolo aprobado por el Comite de Etica.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-alphi-navy">Mis estudios</h2>
            <Link href="/studies" className="text-sm font-medium text-alphi-teal hover:underline">
              Ver todos
            </Link>
          </div>

          {studyList.length === 0 ? (
            <div className="alphi-card p-8 text-center">
              <p className="text-sm font-semibold text-alphi-navy">Sin estudios todavia</p>
              <p className="mt-1 text-xs text-alphi-muted">
                Crea tu primer estudio y sube el protocolo para empezar.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {studyList.map((study) => (
                <Link
                  key={study.id}
                  href={`/studies/${study.id}/chat`}
                  className="alphi-card group flex items-center justify-between px-4 py-3 transition-all duration-150 hover:border-alphi-teal/40 hover:shadow-alphi-panel"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-alphi-navy transition-colors group-hover:text-alphi-teal">
                      {study.name}
                    </p>
                    {study.protocolNumber && (
                      <p className="mt-0.5 font-mono text-xs text-alphi-muted">{study.protocolNumber}</p>
                    )}
                  </div>
                  <div className="ml-3 flex shrink-0 items-center gap-3">
                    <span className={[
                      'alphi-pill text-[11px]',
                      study.status === 'active'
                        ? 'border-alphi-sage/30 bg-alphi-sage/10 text-alphi-sage'
                        : 'border-alphi-border bg-alphi-slate text-alphi-muted',
                    ].join(' ')}>
                      {study.status === 'active' ? 'Activo' : study.status}
                    </span>
                    <span className="text-alphi-muted transition-colors group-hover:text-alphi-teal">&rarr;</span>
                  </div>
                </Link>
              ))}
            </div>
          )}

          <Link href="/studies" className="alphi-btn-secondary mt-1 w-full justify-center">
            + Nuevo estudio
          </Link>
        </div>

        <div className="space-y-3">
          <h2 className="text-base font-bold text-alphi-navy">Consultas recientes</h2>

          {recentConversations.length === 0 ? (
            <div className="alphi-card p-4 text-center">
              <p className="text-sm text-alphi-muted">
                Sin consultas previas. Abri un estudio y empieza a preguntar.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {recentConversations.map((conv) => (
                <Link
                  key={conv.id}
                  href={`/studies/${conv.studyId}/chat?conversationId=${conv.id}`}
                  className="alphi-card group flex items-start gap-2 px-3 py-2.5 transition-all duration-150 hover:border-alphi-teal/40"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-alphi-navy transition-colors group-hover:text-alphi-teal">
                      {conv.title ?? 'Consulta sin titulo'}
                    </p>
                    <p className="mt-0.5 text-xs text-alphi-muted">{formatRelative(conv.updatedAt)}</p>
                  </div>
                </Link>
              ))}
            </div>
          )}

          <div className="alphi-card mt-4 space-y-2.5 p-4">
            <p className="text-xs font-bold uppercase tracking-wider text-alphi-navy">Tips de consulta</p>
            {[
              'Cuales son los criterios de exclusion?',
              'Que medicacion prohibida menciona el protocolo?',
              'Cuales son las ventanas de visitas del SoA?',
              'Como proceso las muestras de PK?',
              'Cual es el timeline de reporte de un SAE?',
            ].map((tip) => (
              <p key={tip} className="border-l-2 border-alphi-teal/30 pl-2 text-[11px] leading-relaxed text-alphi-muted">
                {tip}
              </p>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function DashStat({ value, label }: { value: number; label: string }) {
  return (
    <div className="text-center">
      <p className="text-3xl font-extrabold text-white">{value}</p>
      <p className="mt-0.5 text-xs text-white/50">{label}</p>
    </div>
  )
}
