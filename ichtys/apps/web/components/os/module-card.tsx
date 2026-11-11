import type { ModuleSummaryResult } from '@ichtys/integrations'
import { ArrowUpRight } from 'lucide-react'
import { formatCounter, MODULE_ROUTES, statusCopy } from '../../lib/os/module-status'
import { ButtonLink, Card, Pill } from './ui'

/**
 * Tarjeta de un sistema satélite en el Inicio. Si el sistema no está
 * conectado o no responde, lo dice; nunca muestra números de relleno.
 */
export function ModuleCard({
  id,
  title,
  subtitle,
  result,
}: {
  id: string
  title: string
  subtitle: string
  result: ModuleSummaryResult
}) {
  const copy = statusCopy(result.status)
  const counters = result.summary?.counters.slice(0, 3) ?? []
  return (
    <Card
      labelledBy={id}
      title={title}
      subtitle={subtitle}
      action={<ButtonLink href={MODULE_ROUTES[result.module]}>Ver detalle</ButtonLink>}
    >
      {result.status === 'ok' && counters.length > 0 ? (
        <dl className="grid grid-cols-3 divide-x divide-alphi-border">
          {counters.map((counter) => (
            <div key={counter.key} className="px-3 first:pl-0">
              <dd className="text-2xl font-bold text-os-ink">{formatCounter(counter)}</dd>
              <dt className="mt-1 text-xs text-os-subtle">{counter.label}</dt>
            </div>
          ))}
        </dl>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Pill tone={copy.tone}>{copy.label}</Pill>
          <p className="text-sm text-os-subtle">
            {result.status === 'ok' ? 'El sistema respondió sin indicadores para mostrar.' : copy.hint}
          </p>
        </div>
      )}
    </Card>
  )
}

export function OpenSystemLink({ href }: { href: string }) {
  return (
    <ButtonLink href={href} variant="solid" external>
      Abrir sistema
      <ArrowUpRight aria-hidden="true" className="h-4 w-4" />
    </ButtonLink>
  )
}
