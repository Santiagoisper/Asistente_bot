'use client'

import Link from 'next/link'
import { Search } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { EMPTY_SEARCH, SEARCH_MIN_CHARS, type SearchResults } from '../../lib/os/search-query'

type State = 'idle' | 'loading' | 'done' | 'error'

function isSearchResults(value: unknown): value is SearchResults {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as { studies?: unknown; subjects?: unknown }
  return Array.isArray(candidate.studies) && Array.isArray(candidate.subjects)
}

/** Buscador de la barra superior: estudios y sujetos de la organización. Atajo Ctrl/⌘ K. */
export function SearchBox() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResults>(EMPTY_SEARCH)
  const [state, setState] = useState<State>('idle')
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        inputRef.current?.focus()
      }
    }
    const onPointer = (event: PointerEvent) => {
      if (boxRef.current && event.target instanceof Node && !boxRef.current.contains(event.target)) setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointer)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointer)
    }
  }, [])

  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < SEARCH_MIN_CHARS) {
      setResults(EMPTY_SEARCH)
      setState('idle')
      return
    }
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setState('loading')
      fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error('search_failed')
          const payload: unknown = await response.json()
          if (!isSearchResults(payload)) throw new Error('search_invalid')
          setResults(payload)
          setState('done')
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === 'AbortError') return
          setResults(EMPTY_SEARCH)
          setState('error')
        })
    }, 250)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [query])

  const total = results.studies.length + results.subjects.length
  const showPanel = open && query.trim().length >= SEARCH_MIN_CHARS

  return (
    <div ref={boxRef} className="relative w-full max-w-xl">
      <label className="sr-only" htmlFor={`${listId}-input`}>
        Buscar estudios y sujetos
      </label>
      <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-os-subtle" />
      <input
        ref={inputRef}
        id={`${listId}-input`}
        type="search"
        autoComplete="off"
        value={query}
        placeholder="Buscar estudios y sujetos…"
        aria-controls={showPanel ? listId : undefined}
        className="min-h-11 w-full rounded-xl border border-alphi-border bg-white pl-9 pr-16 text-sm text-os-ink placeholder:text-os-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-os-accent"
        onChange={(event) => {
          setQuery(event.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setOpen(false)
            inputRef.current?.blur()
          }
        }}
      />
      <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded-md border border-alphi-border bg-os-ground px-1.5 py-0.5 text-[11px] font-medium text-os-subtle sm:block">
        Ctrl K
      </kbd>

      {showPanel ? (
        <div id={listId} className="absolute left-0 right-0 top-full z-50 mt-2 max-h-96 overflow-y-auto rounded-xl border border-alphi-border bg-white p-2 shadow-alphi-modal">
          {state === 'loading' ? <p className="px-3 py-2 text-sm text-os-subtle">Buscando…</p> : null}
          {state === 'error' ? <p role="status" className="px-3 py-2 text-sm text-[#8C1D3A]">No se pudo buscar. Probá de nuevo.</p> : null}
          {state === 'done' && total === 0 ? <p className="px-3 py-2 text-sm text-os-subtle">Sin resultados para “{query.trim()}”.</p> : null}
          {([['Estudios', results.studies], ['Sujetos', results.subjects]] as const).map(([heading, hits]) =>
            hits.length > 0 ? (
              <div key={heading} className="py-1">
                <p className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-os-subtle">{heading}</p>
                <ul>
                  {hits.map((hit) => (
                    <li key={hit.id}>
                      <Link
                        href={hit.href}
                        className="flex min-h-11 items-center justify-between gap-3 rounded-lg px-3 text-sm text-os-ink hover:bg-os-tint focus-visible:outline focus-visible:outline-2 focus-visible:outline-os-accent"
                        onClick={() => setOpen(false)}
                      >
                        <span className="font-semibold">{hit.label}</span>
                        <span className="truncate text-os-subtle">{hit.detail}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null,
          )}
        </div>
      ) : null}
    </div>
  )
}
