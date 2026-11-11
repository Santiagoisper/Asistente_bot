import Link from 'next/link'
import type { ReactNode } from 'react'
import type { StatusTone } from '../../lib/os/module-status'

export const focusRing =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-os-accent'

export const cardClass = 'rounded-2xl border border-alphi-border bg-white p-5 shadow-alphi-card'

const TONE_CLASS: Record<StatusTone | 'soon' | 'info', string> = {
  ok: 'bg-os-tint text-os-accentdim',
  idle: 'bg-[#EEF2F6] text-[#334155]',
  warn: 'bg-[#FFF1D6] text-[#6B4200]',
  error: 'bg-[#FBE3E7] text-[#8C1D3A]',
  soon: 'bg-[#ECE6F7] text-[#4A2F87]',
  info: 'bg-[#E2F0F4] text-[#0A4455]',
}

export function Pill({ tone, children }: { tone: StatusTone | 'soon' | 'info'; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${TONE_CLASS[tone]}`}>
      {children}
    </span>
  )
}

export function Card({
  title,
  subtitle,
  action,
  labelledBy,
  children,
  className,
}: {
  title: string
  subtitle?: string
  action?: ReactNode
  labelledBy: string
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`${cardClass} ${className ?? ''}`} aria-labelledby={labelledBy}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={labelledBy} className="text-base font-semibold text-os-ink">
            {title}
          </h2>
          {subtitle ? <p className="mt-0.5 text-sm text-os-subtle">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

export function StatCard({
  label,
  value,
  note,
  icon,
  href,
}: {
  label: string
  /** Número ya formateado, o null cuando el dato todavía no existe. */
  value: string | null
  note: string
  icon: ReactNode
  href?: string
}) {
  const body = (
    <div className="flex items-center gap-4">
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-os-tint text-os-accent">{icon}</span>
      <div className="min-w-0">
        <p className="text-sm font-medium text-os-ink">{label}</p>
        <p className="mt-0.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-3xl font-bold leading-none text-os-ink">{value ?? '—'}</span>
          <span className="text-sm text-os-subtle">{note}</span>
        </p>
      </div>
    </div>
  )
  const className = 'block rounded-2xl border border-alphi-border bg-white p-5 shadow-alphi-card'
  return href ? (
    <Link href={href} className={`${className} transition-colors hover:border-os-accent ${focusRing}`}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  )
}

export function EmptyState({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-alphi-border bg-os-ground px-4 py-6 text-center">
      <p className="text-sm font-semibold text-os-ink">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-os-subtle">{detail}</p>
      {action ? <div className="mt-3 flex justify-center">{action}</div> : null}
    </div>
  )
}

export function LoadError({ what }: { what: string }) {
  return (
    <p role="status" className="rounded-xl bg-[#FBE3E7] px-4 py-3 text-sm text-[#8C1D3A]">
      No se pudo cargar {what}. Recargá la página; si sigue, avisá a soporte.
    </p>
  )
}

export function ButtonLink({
  href,
  children,
  variant = 'outline',
  external,
}: {
  href: string
  children: ReactNode
  variant?: 'solid' | 'outline'
  external?: boolean
}) {
  const className = `inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold ${focusRing} ${
    variant === 'solid'
      ? 'bg-os-accent text-white hover:bg-os-accentdim'
      : 'border-[1.5px] border-os-accent bg-white text-os-accentdim hover:bg-os-tint'
  }`
  return external ? (
    <a href={href} className={className} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ) : (
    <Link href={href} className={className}>
      {children}
    </Link>
  )
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold text-os-ink">{title}</h1>
        <p className="mt-1 text-sm text-os-subtle">{subtitle}</p>
      </div>
      {action}
    </div>
  )
}
