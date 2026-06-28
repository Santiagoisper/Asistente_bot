'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { label: 'Chat',       suffix: 'chat',      icon: '💬' },
  { label: 'Documentos', suffix: 'documents',  icon: '📄' },
  { label: 'Spec',       suffix: 'spec',       icon: '🔬' },
  { label: 'Historial',  suffix: 'history',    icon: '📋' },
]

export function StudyNav({ studyId }: { studyId: string }) {
  const pathname = usePathname()

  return (
    <nav className="flex gap-0">
      {TABS.map((tab) => {
        const href = `/studies/${studyId}/${tab.suffix}`
        const active = pathname?.includes(`/${tab.suffix}`)

        return (
          <Link
            key={tab.label}
            href={href}
            className={[
              'flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold',
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
