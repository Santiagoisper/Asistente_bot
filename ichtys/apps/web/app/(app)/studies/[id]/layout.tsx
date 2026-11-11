import Link from 'next/link'
import { validateStudyAccess, AccessError } from '@ichtys/auth'
import { StudyNav } from '../../../../components/ui/study-nav'

interface StudyLayoutProps {
  children: React.ReactNode
  params: Promise<{ id: string }>
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
      // Respuesta uniforme: no se distingue «no existe» de «existe en otra
      // organización». Confirmar la existencia de un estudio a quien no puede
      // verlo es una fuga entre organizaciones.
      return (
        <div className="mx-auto max-w-lg py-16 text-center">
          <div className="alphi-card space-y-4 p-6">
            <p className="text-sm font-semibold text-alphi-navy">Estudio no disponible</p>
            <p className="text-sm text-alphi-muted">
              No encontramos este estudio en la organización activa, o no tenés permiso para verlo. Si
              trabajás en más de un centro, revisá cuál está activo en el selector de arriba a la
              izquierda.
            </p>
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
