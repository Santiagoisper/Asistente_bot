import Link from 'next/link'
import { validateStudyAccess } from '@ichtys/auth'

interface StudyLayoutProps {
  children: React.ReactNode
  params: Promise<{ id: string }>
}

const TABS = [
  { label: 'Chat', href: (id: string) => `/studies/${id}/chat` },
  { label: 'Documentos', href: (id: string) => `/studies/${id}/documents` },
  { label: 'Spec', href: (id: string) => `/studies/${id}/spec` },
  { label: 'Historial', href: (id: string) => `/studies/${id}/history` },
]

export default async function StudyLayout({ children, params }: StudyLayoutProps) {
  const { id } = await params
  const { study } = await validateStudyAccess(id)

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold">{study.name}</h1>
        {study.protocolNumber && (
          <p className="text-sm text-gray-500">{study.protocolNumber}</p>
        )}
      </div>
      <nav className="flex gap-1 border-b">
        {TABS.map((tab) => (
          <Link
            key={tab.label}
            href={tab.href(id)}
            className="px-3 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 border-b-2 border-transparent hover:border-gray-300 -mb-px transition-colors"
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      <div>{children}</div>
    </div>
  )
}
