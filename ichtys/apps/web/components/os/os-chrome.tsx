'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Bell, Menu, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { isNavActive, OS_NAME, OS_NAV, type NavItem } from '../../lib/os/nav'
import { NavGlyph, OsMark } from './icons'
import { SearchBox } from './search-box'

const focusRing =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-os-accent'

function NavLink({ item, pathname, onNavigate }: { item: NavItem; pathname: string; onNavigate: () => void }) {
  const active = isNavActive(item, pathname)
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      onClick={onNavigate}
      className={`flex min-h-11 items-center gap-3 rounded-xl px-3 text-[15px] transition-colors ${focusRing} ${
        active ? 'bg-os-tint font-semibold text-os-accentdim' : 'text-[#334155] hover:bg-os-ground'
      }`}
    >
      <NavGlyph icon={item.icon} className="h-5 w-5 shrink-0" />
      <span className="flex-1">{item.label}</span>
      {item.soon ? (
        <span className="rounded-full bg-[#ECE6F7] px-2 py-0.5 text-[10px] font-semibold text-[#4A2F87]">Próximamente</span>
      ) : null}
    </Link>
  )
}

function Sidebar({ pathname, onNavigate }: { pathname: string; onNavigate: () => void }) {
  const main = OS_NAV.filter((item) => item.group === 'main')
  const config = OS_NAV.filter((item) => item.group === 'config')
  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto px-3 py-5">
      <Link href="/inicio" onClick={onNavigate} className={`flex items-center gap-2 rounded-lg px-2 py-1 text-base font-bold text-os-ink ${focusRing}`}>
        <OsMark className="h-5 w-6 text-os-accent" />
        {OS_NAME}
      </Link>
      <nav aria-label="Módulos" className="flex flex-col gap-1">
        {main.map((item) => (
          <NavLink key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} />
        ))}
      </nav>
      <nav aria-label="Configuración" className="mt-auto flex flex-col gap-1 border-t border-alphi-border pt-4">
        <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-os-subtle">Configuración</p>
        {config.map((item) => (
          <NavLink key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} />
        ))}
      </nav>
    </div>
  )
}

/**
 * Cáscara del OS: menú lateral, barra superior y contenido. Los controles de
 * Clerk llegan ya renderizados desde el layout de servidor.
 */
export function OsChrome({
  children,
  orgSwitcher,
  userButton,
  priorityCount,
}: {
  children: ReactNode
  orgSwitcher: ReactNode
  userButton: ReactNode
  /** Ítems de "Atención prioritaria"; null si no se pudo calcular. */
  priorityCount: number | null
}) {
  const pathname = usePathname()
  const [drawerOpen, setDrawerOpen] = useState(false)

  useEffect(() => {
    setDrawerOpen(false)
  }, [pathname])

  const bellLabel =
    priorityCount === null
      ? 'Atención prioritaria'
      : priorityCount === 0
        ? 'Atención prioritaria: nada pendiente'
        : `Atención prioritaria: ${priorityCount} ${priorityCount === 1 ? 'ítem' : 'ítems'}`

  return (
    <div className="min-h-screen bg-os-ground text-os-ink lg:grid lg:grid-cols-[232px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-screen border-r border-alphi-border bg-white lg:block">
        <Sidebar pathname={pathname} onNavigate={() => undefined} />
      </aside>

      {drawerOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menú">
          <button type="button" className="absolute inset-0 bg-[#0D1F3C]/40" aria-label="Cerrar el menú" onClick={() => setDrawerOpen(false)} />
          <div className="relative flex h-full w-72 max-w-[85vw] flex-col bg-white shadow-alphi-modal">
            <button
              type="button"
              className={`absolute right-2 top-3 inline-flex h-11 w-11 items-center justify-center rounded-lg text-os-subtle ${focusRing}`}
              aria-label="Cerrar el menú"
              onClick={() => setDrawerOpen(false)}
            >
              <X aria-hidden="true" className="h-5 w-5" />
            </button>
            {/* En la barra el selector se oculta por debajo de 640 px; acá queda a mano. */}
            <div data-testid="drawer-org-switcher" className="border-b border-alphi-border px-4 pb-3 pr-14 pt-4 sm:hidden">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-os-subtle">Organización</p>
              {orgSwitcher}
            </div>
            <div className="min-h-0 flex-1">
              <Sidebar pathname={pathname} onNavigate={() => setDrawerOpen(false)} />
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex min-h-screen min-w-0 flex-col">
        <header className="sticky top-0 z-40 flex min-h-14 items-center gap-3 border-b border-alphi-border bg-white px-4 py-2 sm:px-6">
          <button
            type="button"
            className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-os-ink lg:hidden ${focusRing}`}
            aria-label="Abrir el menú"
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen(true)}
          >
            <Menu aria-hidden="true" className="h-5 w-5" />
          </button>
          <div className="flex min-w-0 flex-1 justify-center">
            <SearchBox />
          </div>
          <Link
            href="/inicio#atencion-prioritaria"
            aria-label={bellLabel}
            className={`relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-os-ink hover:bg-os-ground ${focusRing}`}
          >
            <Bell aria-hidden="true" className="h-5 w-5" strokeWidth={1.75} />
            {priorityCount !== null && priorityCount > 0 ? (
              <span className="absolute right-1 top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#A6314F] px-1 text-[11px] font-bold text-white">
                {priorityCount > 99 ? '99+' : priorityCount}
              </span>
            ) : null}
          </Link>
          <div className="hidden shrink-0 sm:block">{orgSwitcher}</div>
          <div className="shrink-0">{userButton}</div>
        </header>

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>

        <footer className="border-t border-alphi-border bg-white px-6 py-3">
          <p className="text-[11px] text-os-subtle">
            Responde solo desde documentos cargados. Verificar siempre con el protocolo original.
          </p>
        </footer>
      </div>
    </div>
  )
}
