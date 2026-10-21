'use client'

import { useEffect, useState } from 'react'
import { formatUsd } from '../../lib/usage-format'
// Solo tipos: se borran al compilar y no traen código de servidor al navegador.
import type { UsageViewModel } from '../../lib/usage-view'

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; data: UsageViewModel }
  | { status: 'not_enabled' }
  | { status: 'forbidden' }
  | { status: 'error' }

const BAR_COLOR: Record<UsageViewModel['quota']['state'], string> = {
  no_quota: 'bg-alphi-border',
  ok: 'bg-alphi-sage',
  warning: 'bg-alphi-amber',
  exceeded: 'bg-alphi-rose',
}

export function UsagePanel() {
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false

    async function load(): Promise<void> {
      try {
        const response = await fetch('/api/org/usage', { cache: 'no-store' })
        if (cancelled) return
        if (response.status === 503) return setState({ status: 'not_enabled' })
        if (response.status === 401 || response.status === 403) return setState({ status: 'forbidden' })
        if (!response.ok) return setState({ status: 'error' })
        setState({ status: 'ready', data: (await response.json()) as UsageViewModel })
      } catch {
        if (!cancelled) setState({ status: 'error' })
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  if (state.status === 'loading') {
    return <p className="text-sm text-alphi-muted">Cargando consumo…</p>
  }
  if (state.status === 'not_enabled') {
    return (
      <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        El registro de consumo todavía no está activado en este entorno.
      </p>
    )
  }
  if (state.status === 'forbidden') {
    return (
      <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        Solo <code>org_admin</code> o <code>study_admin</code> pueden ver el consumo de la organización.
      </p>
    )
  }
  if (state.status === 'error') {
    return (
      <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
        No se pudo cargar el consumo. Reintentá en unos minutos.
      </p>
    )
  }

  const { data } = state
  const { quota } = data
  const percent = quota.percentUsed ?? 0

  return (
    <div className="space-y-6">
      <section className="alphi-card space-y-3 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold capitalize text-alphi-navy">{data.periodLabel}</h2>
          {quota.planName ? <span className="text-sm text-alphi-muted">Plan {quota.planName}</span> : null}
        </div>

        {quota.budgetUsd !== null ? (
          <>
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
              aria-label="Consumo del cupo mensual"
              className="h-3 w-full overflow-hidden rounded-full bg-alphi-slate"
            >
              <div className={`h-full ${BAR_COLOR[quota.state]}`} style={{ width: `${percent}%` }} />
            </div>
            <p className="text-sm text-alphi-navy">
              <strong>{formatUsd(quota.usedUsd)}</strong> de {formatUsd(quota.budgetUsd)} · quedan{' '}
              <strong>{formatUsd(quota.remainingUsd ?? 0)}</strong> ({percent} % usado)
            </p>
          </>
        ) : (
          <p className="text-sm text-alphi-navy">
            Consumo con la clave de la plataforma: <strong>{formatUsd(quota.usedUsd)}</strong>
          </p>
        )}

        <p className="text-sm text-alphi-muted" role="status">
          {quota.message}
        </p>
      </section>

      <section className="alphi-card overflow-x-auto p-5">
        <h2 className="mb-3 text-lg font-semibold text-alphi-navy">En qué se usó</h2>
        {data.rows.length === 0 ? (
          <p className="text-sm text-alphi-muted">Todavía no hay consumo registrado este mes.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-alphi-border text-alphi-muted">
                <th className="py-2 pr-4 font-medium">Operación</th>
                <th className="py-2 pr-4 text-right font-medium">Llamadas</th>
                <th className="py-2 pr-4 text-right font-medium">Tokens</th>
                <th className="py-2 pr-4 text-right font-medium">Clave de la plataforma</th>
                <th className="py-2 text-right font-medium">Clave propia</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.kind} className="border-b border-alphi-border last:border-0">
                  <td className="py-2 pr-4 text-alphi-navy">{row.label}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{row.calls.toLocaleString('es-AR')}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{row.tokens.toLocaleString('es-AR')}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{formatUsd(row.platformUsd)}</td>
                  <td className="py-2 text-right tabular-nums">{formatUsd(row.orgKeyUsd)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold text-alphi-navy">
                <td className="pt-3 pr-4">Total</td>
                <td className="pt-3 pr-4" />
                <td className="pt-3 pr-4 text-right tabular-nums">{data.totals.totalTokens.toLocaleString('es-AR')}</td>
                <td className="pt-3 pr-4 text-right tabular-nums">{formatUsd(data.totals.platformUsd)}</td>
                <td className="pt-3 text-right tabular-nums">{formatUsd(data.totals.orgKeyUsd)}</td>
              </tr>
            </tfoot>
          </table>
        )}
        <p className="mt-4 text-xs text-alphi-muted">
          Los importes son <strong>estimados</strong> según precios de referencia por modelo; no son la factura
          del proveedor. Solo el consumo con la clave de la plataforma descuenta de tu cupo.
        </p>
      </section>
    </div>
  )
}
