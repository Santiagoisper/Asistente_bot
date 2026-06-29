'use client'

import Link from 'next/link'
import React, { useMemo, useState } from 'react'

export type LibraryTerminology = {
  system: 'SNOMED-CT' | 'LOINC'
  code: string
  display: string
}

export type LibraryRow = {
  studyId: string
  name: string
  protocolCode: string | null
  title: string | null
  phase: string | null
  specStatus: 'draft' | 'approved' | 'superseded' | null
  indexedDocs: number
  inclusionCount: number
  exclusionCount: number
  endpointCount: number
  visitCount: number
  terminology: LibraryTerminology[]
  createdAt: string
  specPartial?: boolean
}

const MAX_TERMINOLOGY_CHIPS = 8

type SpecFilter = 'all' | 'approved' | 'draft' | 'none'

function specStatusLabel(status: LibraryRow['specStatus'], partial?: boolean): string {
  if (partial && status === 'draft') return 'Spec parcial'
  switch (status) {
    case 'approved':
      return 'Spec aprobado'
    case 'draft':
      return 'Spec borrador'
    case 'superseded':
      return 'Spec reemplazado'
    case null:
      return 'Sin spec'
  }
}

function specStatusClass(status: LibraryRow['specStatus']): string {
  switch (status) {
    case 'approved':
      return 'border-alphi-sage/30 bg-alphi-sage/10 text-alphi-sage'
    case 'draft':
      return 'border-alphi-amber/30 bg-alphi-amber/10 text-alphi-amber'
    case 'superseded':
      return 'border-alphi-border bg-alphi-slate text-alphi-muted'
    case null:
      return 'border-alphi-border bg-alphi-slate text-alphi-muted'
  }
}

export function LibraryClient({ rows }: { rows: LibraryRow[] }) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<SpecFilter>('all')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter((r) => {
      if (filter === 'approved' && r.specStatus !== 'approved') return false
      if (filter === 'draft' && r.specStatus !== 'draft') return false
      if (filter === 'none' && r.specStatus !== null) return false
      if (q.length === 0) return true
      return (
        r.name.toLowerCase().includes(q) ||
        (r.protocolCode?.toLowerCase().includes(q) ?? false) ||
        (r.title?.toLowerCase().includes(q) ?? false) ||
        (r.phase?.toLowerCase().includes(q) ?? false)
      )
    })
  }, [rows, query, filter])

  if (rows.length === 0) {
    return (
      <div className="alphi-card flex flex-col items-center justify-center gap-4 py-16 text-center">
        <div>
          <p className="text-base font-bold text-alphi-navy">La librería está vacía</p>
          <p className="mt-1 max-w-xs text-sm text-alphi-muted">
            Importá protocolos para construir la librería con todo extraído automáticamente.
          </p>
        </div>
        <Link href="/studies/import" className="alphi-btn-primary">
          Importar protocolos
        </Link>
      </div>
    )
  }

  const FILTERS: Array<{ id: SpecFilter; label: string }> = [
    { id: 'all', label: 'Todos' },
    { id: 'approved', label: 'Spec aprobado' },
    { id: 'draft', label: 'Borrador' },
    { id: 'none', label: 'Sin spec' },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por nombre, código o fase..."
          className="alphi-input sm:max-w-xs"
        />
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={[
                'rounded-full border px-3 py-1 text-xs font-medium transition-all',
                filter === f.id
                  ? 'border-alphi-teal/60 bg-alphi-teal/10 text-alphi-teal'
                  : 'border-alphi-border bg-white text-alphi-muted hover:border-alphi-teal/40 hover:text-alphi-navy',
              ].join(' ')}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="alphi-card px-4 py-8 text-center text-sm text-alphi-muted">
          No hay protocolos que coincidan con el filtro.
        </p>
      ) : (
        <div className="grid gap-3">
          {filtered.map((r) => (
            <div key={r.studyId} className="alphi-card p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-base font-bold text-alphi-navy">{r.name}</h2>
                    {r.protocolCode && (
                      <span className="rounded bg-alphi-slate px-1.5 py-0.5 font-mono text-[11px] text-alphi-muted">
                        {r.protocolCode}
                      </span>
                    )}
                  </div>
                  {r.title && <p className="mt-0.5 truncate text-sm text-alphi-muted">{r.title}</p>}
                </div>
                <span className={['shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium', specStatusClass(r.specStatus)].join(' ')}>
                  {specStatusLabel(r.specStatus, r.specPartial)}
                </span>
              </div>

              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-alphi-muted">
                {r.phase && <span>Fase: <strong className="text-alphi-navy">{r.phase}</strong></span>}
                <span>Docs indexados: <strong className="text-alphi-navy">{r.indexedDocs}</strong></span>
                <span>Inclusión: <strong className="text-alphi-navy">{r.inclusionCount}</strong></span>
                <span>Exclusión: <strong className="text-alphi-navy">{r.exclusionCount}</strong></span>
                <span>Endpoints: <strong className="text-alphi-navy">{r.endpointCount}</strong></span>
                <span>Visitas: <strong className="text-alphi-navy">{r.visitCount}</strong></span>
              </div>

              {r.terminology.length > 0 && (
                <div className="mt-3 border-t border-alphi-border/50 pt-2.5">
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-alphi-muted">
                    Terminología detectada
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {r.terminology.slice(0, MAX_TERMINOLOGY_CHIPS).map((t) => {
                      const isSnomed = t.system === 'SNOMED-CT'
                      return (
                        <span
                          key={`${t.system}:${t.code}`}
                          title={`${t.system} · ${t.code}\n${t.display}`}
                          className={[
                            'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium',
                            isSnomed
                              ? 'border-alphi-teal/30 bg-alphi-teal/10 text-alphi-teal'
                              : 'border-alphi-sage/30 bg-alphi-sage/10 text-alphi-sage',
                          ].join(' ')}
                        >
                          <span className="font-bold uppercase">{isSnomed ? 'SCT' : 'LOINC'}</span>
                          <span className="max-w-[120px] truncate">{t.display}</span>
                        </span>
                      )
                    })}
                    {r.terminology.length > MAX_TERMINOLOGY_CHIPS && (
                      <span className="inline-flex items-center rounded-full border border-alphi-border px-2 py-0.5 text-[10px] text-alphi-muted">
                        +{r.terminology.length - MAX_TERMINOLOGY_CHIPS}
                      </span>
                    )}
                  </div>
                </div>
              )}

              <div className="mt-4 flex flex-wrap gap-2">
                <Link href={`/studies/${r.studyId}/chat`} className="alphi-btn-secondary text-xs">
                  Consultar
                </Link>
                <Link href={`/studies/${r.studyId}/spec`} className="alphi-btn-ghost text-xs">
                  Ver spec
                </Link>
                <Link href={`/studies/${r.studyId}/documents`} className="alphi-btn-ghost text-xs">
                  Documentos
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
