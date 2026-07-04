'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'

const POLL_MS = 5_000
const MAX_POLLS = 120 // ~10 min

type SpecSummary = {
  version: number | null
  meaningful: boolean
  richness: number
  protocolProcessing: boolean
}

async function fetchSpecSummary(studyId: string): Promise<SpecSummary | null> {
  try {
    const res = await fetch(`/api/studies/${encodeURIComponent(studyId)}/spec?summary=1`, {
      cache: 'no-store',
    })
    if (!res.ok) return null
    return (await res.json()) as SpecSummary
  } catch {
    return null
  }
}

/**
 * Polls hasta que el spec sea útil o deje de haber ingesta en vuelo, luego
 * refresca el server component para mostrar criterios/endpoints sin F5 manual.
 */
export function SpecAutoRefresh({
  studyId,
  enabled,
  initialVersion,
  initialMeaningful,
}: {
  studyId: string
  enabled: boolean
  initialVersion: number | null
  initialMeaningful: boolean
}) {
  const router = useRouter()
  const pollsRef = useRef(0)
  const refreshedRef = useRef(false)
  const lastVersionRef = useRef(initialVersion)

  useEffect(() => {
    if (!enabled || refreshedRef.current) return

    let cancelled = false
    const tick = async () => {
      if (cancelled || refreshedRef.current) return
      pollsRef.current += 1
      if (pollsRef.current > MAX_POLLS) return

      const summary = await fetchSpecSummary(studyId)
      if (!summary || cancelled) return

      const becameMeaningful =
        summary.meaningful &&
        (!initialMeaningful ||
          (summary.version !== null && summary.version !== lastVersionRef.current))

      if (becameMeaningful && !refreshedRef.current) {
        refreshedRef.current = true
        router.refresh()
        return
      }

      if (!summary.protocolProcessing && summary.meaningful && initialMeaningful) {
        refreshedRef.current = true
        return
      }
    }

    void tick()
    const id = setInterval(() => void tick(), POLL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [studyId, enabled, initialMeaningful, initialVersion, router])

  if (!enabled) return null

  return (
    <div className="rounded-xl border border-alphi-teal/30 bg-alphi-teal/5 px-4 py-3 text-sm text-alphi-navy">
      <p className="font-semibold">Extrayendo spec del protocolo…</p>
      <p className="mt-1 text-alphi-muted">
        ALPHI indexa el PDF y extrae criterios, endpoints y visitas. Esta página se actualizará
        sola cuando termine — no hace falta refrescar manualmente.
      </p>
    </div>
  )
}
