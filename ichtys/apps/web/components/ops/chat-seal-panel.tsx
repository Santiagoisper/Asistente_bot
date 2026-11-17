'use client'

import { useState } from 'react'

interface SealStatus {
  organizations: number
  organizationsWithPlain: number
  messages: number
  plainMessages: number
  plainTitles: number
  annotations: number
  target: string | null
}

interface SealResult {
  status: 'done' | 'partial'
  organizations: number
  messages: number
  titles: number
  annotationsCleared: number
  batches: number
  remainingMessages: number
  remainingTitles: number
  remainingAnnotations: number
  blocked: number
}

const ERRORS: Record<string, string> = {
  target_mismatch: 'La base confirmada no es la de este entorno. No se escribió nada.',
  no_key: 'Este entorno no tiene la clave de cifrado. No se escribió nada.',
  key_mismatch: 'La clave de este entorno no abre lo que la base ya tiene cifrado. No se escribió nada.',
  key_unverified: 'No hay nada cifrado en la base contra qué comprobar la clave. No se escribió nada.',
  round_trip: 'Un texto no volvió igual después de cifrarlo. Esa tanda se revirtió entera.',
}

const button =
  'inline-flex items-center rounded-md bg-alphi-navy px-4 py-2 text-sm font-semibold text-white hover:bg-alphi-navydim disabled:cursor-not-allowed disabled:opacity-50 transition-colors'

function Row({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-alphi-navy/10 py-1.5 text-sm">
      <dt className="text-alphi-muted">{label}</dt>
      <dd className="font-semibold tabular-nums text-alphi-navy">{value}</dd>
    </div>
  )
}

/**
 * Dos pasos: contar (no escribe) y sellar (escribe). Sellar queda apagado hasta que se contó,
 * y pide tildar la base de destino que devolvió el conteo: es fácil creer que se está en el
 * entorno de prueba y estar en otro. Solo muestra cantidades; nunca texto del chat.
 */
export function ChatSealPanel() {
  const [status, setStatus] = useState<SealStatus | null>(null)
  const [result, setResult] = useState<SealResult | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState<'count' | 'seal' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const pending = status ? status.plainMessages + status.plainTitles + status.annotations : 0

  async function count() {
    setBusy('count')
    setError(null)
    try {
      const res = await fetch('/api/os/chat-seal', { cache: 'no-store' })
      if (!res.ok) throw new Error(String(res.status))
      setStatus((await res.json()) as SealStatus)
      setConfirmed(false)
    } catch {
      setError('No se pudo contar. No se escribió nada.')
    } finally {
      setBusy(null)
    }
  }

  async function seal() {
    if (!status?.target || !confirmed) return
    setBusy('seal')
    setError(null)
    setResult(null)
    try {
      const res = await fetch('/api/os/chat-seal', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirm: status.target }),
      })
      const body = (await res.json().catch(() => ({}))) as { error?: string; reason?: string }
      if (!res.ok) {
        setError(ERRORS[body.reason ?? ''] ?? ERRORS[body.error ?? ''] ?? 'El sellado falló. Volvé a contar para ver qué quedó.')
        return
      }
      setResult(body as unknown as SealResult)
      setConfirmed(false)
      await count()
    } catch {
      setError('No hubo respuesta. Volvé a contar para ver qué quedó: puede haberse sellado una parte.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="mx-auto max-w-2xl space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-alphi-navy">Sellado del chat</h1>
        <p className="text-sm text-alphi-muted">
          Pasa a cifrado las preguntas, respuestas y títulos que se guardaron en claro antes del 16/11/2026, y vacía las
          anotaciones viejas. No cambia el contenido. Acá solo se ven cantidades.
        </p>
      </header>

      <div className="space-y-3 rounded-md border border-alphi-navy/10 bg-white p-4 shadow-alphi-card">
        <h2 className="text-sm font-semibold text-alphi-navy">1. Contar</h2>
        <p className="text-sm text-alphi-muted">No escribe nada.</p>
        <button type="button" className={button} onClick={count} disabled={busy !== null}>
          {busy === 'count' ? 'Contando…' : 'Contar'}
        </button>
        {status && (
          <dl aria-label="Lo que hay en la base">
            <Row label="Base de este entorno" value={status.target ?? 'sin dirección'} />
            <Row label="Mensajes en total" value={status.messages} />
            <Row label="Mensajes en claro" value={status.plainMessages} />
            <Row label="Títulos en claro" value={status.plainTitles} />
            <Row label="Mensajes con anotaciones viejas" value={status.annotations} />
            <Row label="Organizaciones con algo en claro" value={`${status.organizationsWithPlain} de ${status.organizations}`} />
          </dl>
        )}
      </div>

      <div className="space-y-3 rounded-md border border-alphi-navy/10 bg-white p-4 shadow-alphi-card">
        <h2 className="text-sm font-semibold text-alphi-navy">2. Sellar</h2>
        {!status && <p className="text-sm text-alphi-muted">Primero contá.</p>}
        {status && pending === 0 && <p className="text-sm text-alphi-muted">No queda nada en claro en esta base.</p>}
        {status && pending > 0 && (
          <>
            <label className="flex items-start gap-2 text-sm text-alphi-navy">
              <input type="checkbox" className="mt-1" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
              <span>
                Voy a sellar la base <strong className="break-all">{status.target ?? 'sin dirección'}</strong>. Es la que corresponde.
              </span>
            </label>
            <button type="button" className={button} onClick={seal} disabled={busy !== null || !confirmed || !status.target}>
              {busy === 'seal' ? 'Sellando…' : 'Sellar'}
            </button>
          </>
        )}
        {result && (
          <div className="space-y-2">
            <p className="text-sm font-semibold text-alphi-navy">
              {result.status === 'done' ? 'Terminado: no queda nada en claro.' : 'Quedó una parte sin sellar. Se puede volver a apretar Sellar.'}
            </p>
            <dl aria-label="Resultado del sellado">
              <Row label="Mensajes sellados" value={result.messages} />
              <Row label="Títulos sellados" value={result.titles} />
              <Row label="Anotaciones vaciadas" value={result.annotationsCleared} />
              <Row label="Tandas" value={result.batches} />
              <Row label="Quedan: mensajes / títulos / anotaciones" value={`${result.remainingMessages} / ${result.remainingTitles} / ${result.remainingAnnotations}`} />
              <Row label="Filas que no se tocaron (su versión cifrada no abre)" value={result.blocked} />
            </dl>
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="rounded-md border border-alphi-amber/30 bg-alphi-amber/10 px-4 py-3 text-sm text-alphi-amber">
          {error}
        </p>
      )}
    </section>
  )
}
