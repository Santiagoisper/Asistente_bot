import Link from 'next/link'
import type { ReactNode } from 'react'

const NAV = [
  { href: '/pricing', label: 'Precios' },
  { href: '/trust', label: 'Trust Center' },
  { href: '/roi', label: 'ROI' },
  { href: '/terms', label: 'Términos' },
  { href: '/privacy', label: 'Privacidad' },
] as const

const DEMO_MAILTO = 'mailto:sisbert@cinme.com.ar?subject=Demo%20ALPHI%20Ichtys'

interface MarketingShellProps {
  children: ReactNode
  /** Optional eyebrow above page title */
  eyebrow?: string
  title?: string
  description?: string
}

export function MarketingShell({ children, eyebrow, title, description }: MarketingShellProps) {
  return (
    <div className="min-h-screen bg-alphi-slate/30">
      <header className="border-b border-alphi-border bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4">
          <Link href="/sign-in" className="text-sm font-bold text-alphi-navy">
            Ichtys <span className="font-normal text-alphi-muted">/ ALPHI</span>
          </Link>
          <nav className="hidden items-center gap-5 text-xs font-medium text-alphi-muted md:flex">
            {NAV.map((item) => (
              <Link key={item.href} href={item.href} className="hover:text-alphi-teal">
                {item.label}
              </Link>
            ))}
          </nav>
          <Link
            href={DEMO_MAILTO}
            className="rounded-md bg-alphi-teal px-3 py-1.5 text-xs font-semibold text-white hover:bg-alphi-navy"
          >
            Solicitar demo
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-12">
        {(eyebrow || title || description) && (
          <header className="mb-10">
            {eyebrow && (
              <p className="text-xs font-semibold uppercase tracking-widest text-alphi-teal">{eyebrow}</p>
            )}
            {title && <h1 className="mt-2 text-3xl font-bold text-alphi-navy">{title}</h1>}
            {description && (
              <p className="mt-3 text-sm leading-relaxed text-alphi-muted">{description}</p>
            )}
          </header>
        )}
        {children}
      </main>

      <footer className="border-t border-alphi-border bg-white py-8">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-3 px-6 text-center text-xs text-alphi-muted md:flex-row md:justify-between">
          <p>© 2026 Ichtys/ALPHI · MVP pre-validación · Sin PHI real en producción</p>
          <div className="flex flex-wrap justify-center gap-4">
            {NAV.map((item) => (
              <Link key={item.href} href={item.href} className="hover:text-alphi-teal">
                {item.label}
              </Link>
            ))}
            <Link href="/sign-in" className="font-semibold text-alphi-teal hover:underline">
              Acceder
            </Link>
          </div>
        </div>
      </footer>
    </div>
  )
}

export { DEMO_MAILTO }
