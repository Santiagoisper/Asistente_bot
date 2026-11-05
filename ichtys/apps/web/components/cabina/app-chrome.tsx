'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const focusRing = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white'

export function DemoNavLink() {
  const pathname = usePathname()
  const active = pathname.startsWith('/demo')
  return (
    <Link
      href="/demo"
      aria-label="Estudio de demostración"
      aria-current={active ? 'page' : undefined}
      className={`rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors hover:bg-white/10 hover:text-white ${focusRing} ${active ? 'text-white' : 'text-white/75'}`}
    >
      Demo
    </Link>
  )
}

export function GcpBadge() {
  const pathname = usePathname()
  if (pathname.startsWith('/demo')) return null
  return (
    <span className="hidden items-center gap-1.5 rounded-full border border-alphi-teal/40 bg-alphi-teal/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-alphi-teal/90 lg:inline-flex">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-alphi-teal" />
      GCP Compliant
    </span>
  )
}
