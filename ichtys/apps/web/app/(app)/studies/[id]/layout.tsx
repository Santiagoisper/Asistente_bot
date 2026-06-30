import Link from 'next/link'
import { auth } from '@clerk/nextjs/server'
import {
  validateStudyAccess,
  AccessError,
  studyExistsInAnotherOrganization,
  resolveOrProvisionOrganization,
} from '@ichtys/auth'
import { StudyNav } from '../../../../components/ui/study-nav'

interface StudyLayoutProps {
  children: React.ReactNode
  params: Promise<{ id: string }>
}

async function studyWrongOrgHint(studyId: string): Promise<boolean> {
  const { orgId: clerkOrgId } = await auth()
  if (!clerkOrgId) return false
  const org = await resolveOrProvisionOrganization(clerkOrgId)
  if (!org) return false
  return studyExistsInAnotherOrganization(studyId, org.id)
}

export default async function StudyLayout({ children, params }: StudyLayoutProps) {
  const { id } = await params

  try {
    const { study } = await validateStudyAccess(id)

    return (
      <div className="mx-auto max-w-6xl">
        <div className="alphi-card rounded-b-none border-b-0 px-5 pt-4 pb-0 mb-0">
          <div className="mb-3 flex items-start justify-between gap-4">
            <div>
              <p className="alphi-label mb-1">Estudio activo</p>
              <h1 className="text-xl font-bold leading-tight text-alphi-navy">{study.name}</h1>
              {study.protocolNumber && (
                <p className="mt-0.5 font-mono text-sm text-alphi-muted">{study.protocolNumber}</p>
              )}
            </div>
            <span className="alphi-pill mt-1 shrink-0 border-alphi-sage/30 bg-alphi-sage/10 text-alphi-sage">
              <span className="h-1.5 w-1.5 rounded-full bg-alphi-sage" />
              Activo
            </span>
          </div>
          <StudyNav studyId={id} />
        </div>
        <div className="alphi-card min-h-[500px] rounded-t-none border-t-0 p-5">{children}</div>
      </div>
    )
  } catch (err) {
    if (err instanceof AccessError && err.status === 404) {
      const hintWrongOrg = await studyWrongOrgHint(id)

      return (
        <div className="mx-auto max-w-lg py-16 text-center">
          <div className="alphi-card space-y-4 p-6">
            <p className="text-sm font-semibold text-alphi-navy">Estudio no disponible</p>
            {hintWrongOrg ? (
              <p className="text-sm text-alphi-muted">
                Este estudio existe pero pertenece a <strong>otra organización</strong>. Cambiá la org
                activa con el selector arriba a la izquierda (ej. <strong>INNOVA TRIALS</strong>) y volvé a
                intentar.
              </p>
            ) : (
              <p className="text-sm text-alphi-muted">
                No encontramos este estudio en la organización activa, o no tenés permiso para verlo.
              </p>
            )}
            <Link href="/studies" className="alphi-btn-primary inline-block text-sm">
              Ir a mis estudios
            </Link>
          </div>
        </div>
      )
    }
    throw err
  }
}
