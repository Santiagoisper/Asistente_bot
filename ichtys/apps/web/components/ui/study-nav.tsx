'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { label: 'Chat',       suffix: 'chat',      icon: '💬' },
  { label: 'Sujetos',    suffix: 'subjects',  icon: '👤' },
  { label: 'Documentos', suffix: 'documents',  icon: '📄' },
  { label: 'Spec',       suffix: 'spec',       icon: '🔬' },
  { label: 'Historial',  suffix: 'history',    icon: '📋' },
]

export function StudyNav({ studyId }: { studyId: string }) {
  const pathname = usePathname()

  return (
    // Sin overflow-x-auto, los 5 tabs no entraban en 375px: en vez de
    // achicarse, empujaban el ancho de TODA la tarjeta/página y rompían el
    // header sticky de arriba (medido por Foreman: desbordaba hasta 573px).
    // shrink-0 evita que el propio flex los comprima y trunque el texto.
    <nav className="-mx-5 flex gap-0 overflow-x-auto px-5 sm:mx-0 sm:px-0" aria-label="Secciones del estudio">
      {TABS.map((tab) => {
        const href = `/studies/${studyId}/${tab.suffix}`
        const active = pathname?.includes(`/${tab.suffix}`)

        return (
          <Link
            key={tab.label}
            href={href}
            className={[
              'flex shrink-0 items-center gap-1.5 whitespace-nowrap px-4 py-2.5 text-sm font-semibold',
              'border-b-2 -mb-px transition-all duration-150',
              active
                ? 'border-alphi-teal text-alphi-teal'
                : 'border-transparent text-alphi-muted hover:text-alphi-navy hover:border-alphi-border',
            ].join(' ')}
          >
            <span className="text-sm leading-none">{tab.icon}</span>
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
