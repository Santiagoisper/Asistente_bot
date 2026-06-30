import Link from 'next/link'
import { OrganizationSwitcher, UserButton } from '@clerk/nextjs'
import { AlphiLogo } from '../../components/ui/alphi-logo'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-alphi-slate">

      <header className="sticky top-0 z-50 flex h-14 items-center justify-between border-b border-alphi-border bg-alphi-navy px-4 shadow-alphi-panel">
        <div className="flex items-center gap-5">
          <Link href="/dashboard" className="flex items-center">
            <AlphiLogo variant="full" height={28} theme="white" />
          </Link>
          <nav className="hidden items-center gap-1 sm:flex" aria-label="Navegación principal">
            <Link
              href="/studies"
              className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-white/75 transition-colors hover:bg-white/10 hover:text-white"
            >
              Estudios
            </Link>
            <Link
              href="/library"
              className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-white/75 transition-colors hover:bg-white/10 hover:text-white"
            >
              Librería
            </Link>
            <Link
              href="/settings"
              className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-white/75 transition-colors hover:bg-white/10 hover:text-white"
            >
              Ajustes
            </Link>
          </nav>
          <span className="hidden h-5 w-px bg-white/20 sm:block" />
          <div className="hidden sm:block">
            <OrganizationSwitcher
              hidePersonal
              appearance={{
                variables: {
                  colorBackground:       '#FFFFFF',
                  colorText:             '#0D1F3C',
                  colorTextSecondary:    '#64748B',
                  colorPrimary:          '#0891B2',
                  colorNeutral:          '#0D1F3C',
                  colorInputBackground:  '#F8FAFC',
                  colorInputText:        '#0D1F3C',
                  borderRadius:          '0.75rem',
                  fontFamily:            'inherit',
                },
                elements: {
                  // ── Trigger (inside dark nav header) ────────────────────
                  organizationSwitcherTrigger:
                    'text-white/80 hover:text-white hover:bg-white/10 rounded-lg px-2 py-1 transition-colors',
                  organizationPreviewTextContainer:
                    'text-white',
                  organizationPreviewMainIdentifier:
                    'text-white font-semibold text-sm',
                  organizationPreviewSecondaryIdentifier:
                    'text-white/60 text-xs',
                  organizationSwitcherTriggerIcon:
                    'text-white/60',

                  // ── Popup card ───────────────────────────────────────────
                  organizationSwitcherPopoverCard:
                    'bg-white border border-[#E2E8F0] shadow-xl rounded-xl overflow-hidden',
                  organizationSwitcherPopoverMain:
                    'bg-white',

                  // ── Org preview rows inside popup ────────────────────────
                  organizationSwitcherPreviewButton:
                    'hover:bg-[#F8FAFC] rounded-lg',
                  organizationPreview__organizationSwitcherTrigger:
                    'text-[#0D1F3C]',

                  // ── Action buttons (Create org / Manage) ─────────────────
                  organizationSwitcherPopoverActions:
                    'border-t border-[#E2E8F0] bg-[#F8FAFC]',
                  organizationSwitcherPopoverActionButton:
                    'text-[#0D1F3C] hover:bg-[#E2E8F0] rounded-lg font-medium text-sm',
                  organizationSwitcherPopoverActionButtonText:
                    'text-[#0D1F3C]',
                  organizationSwitcherPopoverActionButtonIcon:
                    'text-[#64748B]',

                  // ── Footer ────────────────────────────────────────────────
                  organizationSwitcherPopoverFooter:
                    'border-t border-[#E2E8F0] bg-[#F8FAFC]',

                  // ── Notification badge ────────────────────────────────────
                  notificationBadge:
                    'bg-[#0891B2] text-white',
                },
              }}
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="hidden md:inline-flex items-center gap-1.5 rounded-full border border-alphi-teal/40 bg-alphi-teal/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-alphi-teal/90">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-alphi-teal" />
            GCP Compliant
          </span>
          <UserButton appearance={{ elements: { avatarBox: 'w-8 h-8' } }} />
        </div>
      </header>

      <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
        {children}
      </main>

      <footer className="border-t border-alphi-border bg-white px-6 py-3">
        <div className="flex items-center justify-between">
          <p className="text-[11px] text-alphi-muted">
            ALPHI &copy; 2026 - Responde solo desde documentos cargados. Verificar siempre con el protocolo original.
          </p>
          <p className="hidden text-[11px] text-alphi-muted sm:block">
            v1.0 MVP - CINME / Innova Trials
          </p>
        </div>
      </footer>
    </div>
  )
}
