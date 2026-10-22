'use client'

import { useEffect, useState } from 'react'

type QuotaState = 'no_quota' | 'ok' | 'warning' | 'exceeded'
type KeySource = 'platform' | 'org'

type UsageBreakdownItem = {
  kind: string
  label: string
  keySource: KeySource
  calls: number
  tokens: number
  costUsd: number
}

type UsagePayload = {
  plan: { name: string | null; budgetUsd: number | null }
  period: { start: string; end: string }
  quota: {
    state: QuotaState
    usedUsd: number
    remainingUsd: number | null
    percentUsed: number | null
    warningRatio: number
  }
  breakdown: UsageBreakdownItem[]
  totals: {
    platformUsd: number
    orgKeyUsd: number
    totalUsd: number
    platformTokens: number
    orgKeyTokens: number
    totalTokens: number
  }
}

const BAR_COLOR: Record<QuotaState, string> = {
  no_quota: 'bg-alphi-muted/40',
  ok: 'bg-alphi-sage',
  warning: 'bg-alphi-amber',
  exceeded: 'bg-alphi-rose',
}

const STATE_LABEL: Record<QuotaState, string> = {
  no_quota: 'Sin cupo definido',
  ok: 'Dentro del cupo',
  warning: 'Acercándose al cupo',
  exceeded: 'Cupo agotado',
}

function formatUsd(value: number): string {
  return `USD ${value.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatMonth(iso: string): string {
  return new Date(iso).toLocaleDateString('es-AR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

export function UsagePanel() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<UsagePayload | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/org/usage')
        if (!res.ok) throw new Error('load failed')
        setData((await res.json()) as UsagePayload)
      } catch {
        setError('No se pudo cargar el consumo.')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  if (loading) {
    return <p className="text-sm text-alphi-muted">Cargando consumo…</p>
  }

  if (error || !data) {
    return <p className="text-sm text-alphi-rose">{error ?? 'No se pudo cargar el consumo.'}</p>
  }

  const { quota, plan, period, breakdown, totals } = data
  const barPercent = quota.percentUsed ?? 0
  const displayPercent = Math.round(Math.min(100, barPercent))
  const warningPercent = Math.round(quota.warningRatio * 100)

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-alphi-border bg-white p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-alphi-navy">
            Cupo del mes · {formatMonth(period.start)}
          </h2>
          <span className="text-xs font-medium text-alphi-muted">{plan.name ?? 'Sin plan asignado'}</span>
        </div>

        {quota.state === 'no_quota' ? (
          <p className="mt-3 text-sm text-alphi-muted">
            Esta organización no tiene un cupo mensual definido — el uso no está limitado. Consumido
            hasta ahora este mes: <strong className="text-alphi-navy">{formatUsd(quota.usedUsd)}</strong>.
          </p>
        ) : (
          <>
            <div className="mt-4">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-lg font-semibold text-alphi-navy">{formatUsd(quota.usedUsd)}</span>
                <span className="text-xs text-alphi-muted">
                  de {plan.budgetUsd !== null ? formatUsd(plan.budgetUsd) : '—'} incluidos
                </span>
              </div>
              <div
                className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-alphi-slate"
                role="progressbar"
                aria-label="Cupo mensual consumido"
                aria-valuenow={displayPercent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuetext={`${displayPercent}% — ${STATE_LABEL[quota.state]}`}
              >
                <div
                  className={`h-full rounded-full transition-all ${BAR_COLOR[quota.state]}`}
                  style={{ width: `${displayPercent}%` }}
                />
              </div>
              <div className="mt-1 flex items-center justify-between text-[11px] text-alphi-muted">
                <span>{STATE_LABEL[quota.state]} · {displayPercent}%</span>
                {quota.remainingUsd !== null && quota.state !== 'exceeded' && (
                  <span>Quedan {formatUsd(quota.remainingUsd)}</span>
                )}
              </div>
            </div>

            {quota.state === 'warning' && (
              <p className="mt-3 rounded-md border border-alphi-amber/30 bg-alphi-amber/10 px-3 py-2 text-xs text-alphi-amber">
                Ya usaste el {displayPercent}% del cupo incluido (el aviso aparece a partir del {warningPercent}%).
                Si se agota antes de fin de mes, podés cargar tu propia clave de modelo en{' '}
                <a href="/settings" className="underline">Ajustes</a> para seguir sin interrupciones.
              </p>
            )}

            {quota.state === 'exceeded' && (
              <p className="mt-3 rounded-md border border-alphi-rose/30 bg-alphi-rose/10 px-3 py-2 text-xs text-alphi-rose">
                Se agotó el cupo incluido de este mes. El chat con la clave de la plataforma queda
                pausado hasta el próximo período — cargá tu propia clave en{' '}
                <a href="/settings" className="underline">Ajustes</a> para seguir usando ALPHI sin esperar,
                o ampliá el plan.
              </p>
            )}
          </>
        )}
      </div>

      <div className="rounded-lg border border-alphi-border bg-white p-4">
        <h2 className="text-sm font-semibold text-alphi-navy">Desglose por tipo</h2>
        <p className="mt-1 text-xs text-alphi-muted">
          Solo conteos y costo estimado — nunca se guardan preguntas, respuestas ni texto de documentos.
        </p>

        {breakdown.length === 0 ? (
          <p className="mt-3 text-xs text-alphi-muted">Todavía no hay consumo registrado este mes.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-alphi-muted">
                  <th scope="col" className="pb-2 font-medium">Tipo</th>
                  <th scope="col" className="pb-2 font-medium">Clave</th>
                  <th scope="col" className="pb-2 font-medium">Llamadas</th>
                  <th scope="col" className="pb-2 font-medium">Tokens</th>
                  <th scope="col" className="pb-2 font-medium">Costo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-alphi-border">
                {breakdown.map((row, i) => (
                  <tr key={`${row.kind}-${row.keySource}-${i}`}>
                    <td className="py-2 text-alphi-navy">{row.label}</td>
                    <td className="py-2 text-alphi-muted">{row.keySource === 'org' ? 'Tu org' : 'Plataforma'}</td>
                    <td className="py-2 text-alphi-muted">{row.calls}</td>
                    <td className="py-2 text-alphi-muted">{row.tokens.toLocaleString('es-AR')}</td>
                    <td className="py-2 font-mono text-alphi-navy">{formatUsd(row.costUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-4 border-t border-alphi-border pt-3 text-xs text-alphi-muted">
          <span>Con clave de plataforma: <strong className="text-alphi-navy">{formatUsd(totals.platformUsd)}</strong></span>
          <span>Con clave propia: <strong className="text-alphi-navy">{formatUsd(totals.orgKeyUsd)}</strong></span>
          <span>Total del mes: <strong className="text-alphi-navy">{formatUsd(totals.totalUsd)}</strong></span>
        </div>
      </div>
    </div>
  )
}
