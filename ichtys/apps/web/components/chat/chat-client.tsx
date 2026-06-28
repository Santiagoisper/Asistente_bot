'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  fetchConversationMessages,
  fetchConversations,
  fetchMessageCitations,
} from './chat-api'
import { ConfidenceBadge } from './confidence-badge'
import { EvidenceList, renderAnswerWithFootnotes } from './evidence-list'
import { AlphiLogo } from '../ui/alphi-logo'
import type { AnswerConfidence, ChatTurn, ConversationListItem, Evidence, MedicalAnnotation, MessageItem } from './types'

type ChatClientProps = {
  studyId: string
  studyName: string
  protocolNumber: string | null
  initialConversationId?: string | null
  /** Pre-fills the chat input; comes from ?q= when navigating from the Protocol Navigator. */
  initialQuestion?: string | null
}

const SAFE_ERROR_MESSAGE = 'No se pudo completar la operacion. Intenta nuevamente.'

const SUGGESTED = [
  'Cuales son los criterios de inclusion?',
  'Que medicacion concomitante esta prohibida?',
  'Cuales son las ventanas de visitas del SoA?',
  'Como proceso y envio las muestras de PK?',
  'Cual es el timeline de reporte de un SAE?',
]

// SSE frame types from /api/chat/stream
type StreamStartFrame       = { type: 'start';       conversationId: string; userMessageId: string }
type StreamTokenFrame       = { type: 'token';       text: string }
type StreamDoneFrame        = { type: 'done';        assistantMessageId: string; confidence: AnswerConfidence; evidences: Evidence[]; retrievalCount: number; conversationId: string }
type StreamAnnotationsFrame = { type: 'annotations'; annotations: MedicalAnnotation[] }
type StreamErrorFrame       = { type: 'error' }
type StreamFrame = StreamStartFrame | StreamTokenFrame | StreamDoneFrame | StreamAnnotationsFrame | StreamErrorFrame

function isStartFrame(f: StreamFrame):       f is StreamStartFrame       { return f.type === 'start' }
function isDoneFrame(f: StreamFrame):        f is StreamDoneFrame        { return f.type === 'done' }
function isAnnotationsFrame(f: StreamFrame): f is StreamAnnotationsFrame { return f.type === 'annotations' }

function parseFrame(line: string): StreamFrame | null {
  if (!line.startsWith('data: ')) return null
  try {
    return JSON.parse(line.slice(6)) as StreamFrame
  } catch {
    return null
  }
}

export default function ChatClient({
  studyId,
  studyName,
  protocolNumber,
  initialConversationId = null,
  initialQuestion = null,
}: ChatClientProps) {
  const [conversations, setConversations]         = useState<ConversationListItem[]>([])
  const [selectedConvId, setSelectedConvId]       = useState<string | null>(null)
  const [turns, setTurns]                         = useState<ChatTurn[]>([])
  const [question, setQuestion]                   = useState('')
  const [isSending, setIsSending]                 = useState(false)
  const [streamingTurnId, setStreamingTurnId]     = useState<string | null>(null)
  const [isLoadingHistory, setIsLoadingHistory]   = useState(true)
  const [isLoadingMessages, setIsLoadingMessages] = useState(false)
  const [historyError, setHistoryError]           = useState<string | null>(null)
  const [sendError, setSendError]                 = useState<string | null>(null)
  const [highlightIdx, setHighlightIdx]           = useState<number | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef    = useRef<HTMLTextAreaElement>(null)

  // Load sidebar conversation list
  useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoadingHistory(true)
      setHistoryError(null)
      try {
        const loaded = await fetchConversations(studyId)
        if (cancelled) return
        setConversations(loaded)
        if (initialConversationId && loaded.some((c) => c.conversationId === initialConversationId)) {
          setSelectedConvId(initialConversationId)
        } else {
          setSelectedConvId(loaded.at(0)?.conversationId ?? null)
        }
      } catch {
        if (!cancelled) setHistoryError('No se pudo cargar el historial.')
      } finally {
        if (!cancelled) setIsLoadingHistory(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [studyId, initialConversationId])

  // Load messages when conversation changes
  useEffect(() => {
    let cancelled = false
    if (!selectedConvId) { setTurns([]); return }
    async function load() {
      setIsLoadingMessages(true)
      try {
        const msgs = await fetchConversationMessages(selectedConvId!)
        const hydrated = await hydrateMessages(msgs)
        if (!cancelled) setTurns(hydrated)
      } catch {
        if (!cancelled) setTurns([])
      } finally {
        if (!cancelled) setIsLoadingMessages(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [selectedConvId])

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [turns, isSending])

  // Pre-fill question from Protocol Navigator "Preguntar a ALPHI" button
  useEffect(() => {
    if (!initialQuestion) return
    setQuestion(initialQuestion)
    // Focus textarea so the user can review before sending
    requestAnimationFrame(() => textareaRef.current?.focus())
  }, [initialQuestion])

  const canSend = useMemo(() => question.trim().length > 0 && !isSending, [question, isSending])

  const handleSubmit = useCallback(async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const q = question.trim()
    if (!q) return

    setIsSending(true)
    setSendError(null)
    setHighlightIdx(null)
    setQuestion('')

    const pendingUserId = `pending-user-${Date.now()}`
    const streamId      = `streaming-${Date.now()}`

    // Optimistically add user bubble + empty assistant bubble
    const pendingUserTurn: ChatTurn = {
      messageId: pendingUserId,
      role: 'user',
      content: q,
      confidence: null,
      evidences: [],
      retrievalCount: null,
    }
    const streamingTurn: ChatTurn = {
      messageId: streamId,
      role: 'assistant',
      content: '',
      confidence: null,
      evidences: [],
      retrievalCount: null,
    }
    setTurns((prev) => [...prev, pendingUserTurn, streamingTurn])
    setStreamingTurnId(streamId)

    let resolvedConvId = selectedConvId

    try {
      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studyId,
          question: q,
          ...(selectedConvId ? { conversationId: selectedConvId } : {}),
        }),
      })

      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`)
      }

      const reader  = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        // SSE frames are delimited by double newline
        const parts = buffer.split('\n\n')
        buffer = parts.pop() ?? ''

        for (const part of parts) {
          const frame = parseFrame(part.trim())
          if (!frame) continue

          if (isStartFrame(frame)) {
            // Replace pending user turn with real messageId
            resolvedConvId = frame.conversationId
            setSelectedConvId(frame.conversationId)
            setTurns((prev) =>
              prev.map((t) => (t.messageId === pendingUserId ? { ...t, messageId: frame.userMessageId } : t))
            )
            setConversations((prev) => upsertConv(prev, studyId, frame.conversationId))

          } else if (frame.type === 'token') {
            // Append token to streaming assistant bubble
            setTurns((prev) =>
              prev.map((t) =>
                t.messageId === streamId ? { ...t, content: t.content + frame.text } : t
              )
            )

          } else if (isDoneFrame(frame)) {
            // Replace streaming bubble with complete turn
            resolvedConvId = frame.conversationId
            setTurns((prev) =>
              prev.map((t) =>
                t.messageId === streamId
                  ? {
                      messageId: frame.assistantMessageId,
                      role: 'assistant' as const,
                      content: t.content, // already accumulated from tokens
                      confidence: frame.confidence,
                      evidences: frame.confidence === 'insufficient_evidence' ? [] : frame.evidences,
                      retrievalCount: frame.retrievalCount,
                    }
                  : t
              )
            )

          } else if (isAnnotationsFrame(frame)) {
            // Attach medical annotations to the just-completed assistant turn.
            // At this point streamId has already been replaced with assistantMessageId
            // but we can't know it here — match by role+position (last assistant turn).
            setTurns((prev) => {
              const lastAssistantIdx = prev.map((t) => t.role).lastIndexOf('assistant')
              if (lastAssistantIdx === -1) return prev
              return prev.map((t, i) =>
                i === lastAssistantIdx ? { ...t, annotations: frame.annotations } : t
              )
            })

          } else if (frame.type === 'error') {
            throw new Error('stream_error')
          }
        }
      }
    } catch {
      setSendError(SAFE_ERROR_MESSAGE)
      setTurns((prev) =>
        prev.filter((t) => t.messageId !== pendingUserId && t.messageId !== streamId)
      )
    } finally {
      setIsSending(false)
      setStreamingTurnId(null)
      setTimeout(() => textareaRef.current?.focus(), 50)
      void resolvedConvId // prevent unused-var lint warning
    }
  }, [question, studyId, selectedConvId])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && canSend) {
      e.preventDefault()
      e.currentTarget.form?.requestSubmit()
    }
  }, [canSend])

  return (
    <div className="flex h-[calc(100vh-220px)] min-h-[560px] gap-0">
      {/* Study metadata -- used by tests and screen-readers */}
      <span className="sr-only">Study ID: {studyId}</span>
      {protocolNumber && <span className="sr-only">Protocolo {protocolNumber}</span>}

      {/* Sidebar: conversation list */}
      <aside className="hidden w-56 shrink-0 flex-col border-r border-alphi-border lg:flex">
        <div className="flex items-center justify-between border-b border-alphi-border px-3 py-3">
          <p className="alphi-label">Conversaciones</p>
          <button
            type="button"
            className="alphi-btn-ghost px-2 py-1 text-xs"
            onClick={() => { setSelectedConvId(null); setTurns([]) }}
          >
            + Nueva
          </button>
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {isLoadingHistory && <p className="px-3 py-2 text-xs text-alphi-muted">Cargando historial...</p>}
          {historyError && <p className="px-3 py-2 text-xs text-alphi-amber">{historyError}</p>}
          {!isLoadingHistory && conversations.length === 0 && (
            <p className="px-3 py-4 text-center text-xs text-alphi-muted">Sin conversaciones previas</p>
          )}
          {conversations.map((conv) => (
            <button
              key={conv.conversationId}
              type="button"
              onClick={() => setSelectedConvId(conv.conversationId)}
              className={[
                'w-full border-l-2 px-3 py-2.5 text-left transition-all duration-100',
                conv.conversationId === selectedConvId
                  ? 'border-l-alphi-teal bg-alphi-teal/5 text-alphi-navy'
                  : 'border-l-transparent text-alphi-muted hover:bg-alphi-slate hover:text-alphi-navy',
              ].join(' ')}
            >
              <span className="block truncate text-xs font-semibold">
                {conv.title ?? 'Consulta sin titulo'}
              </span>
              <span className="mt-0.5 block text-[10px] text-alphi-muted">
                {formatDate(conv.updatedAt)}
              </span>
            </button>
          ))}
        </div>
      </aside>

      {/* Main chat area */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {isLoadingMessages && (
            <div className="flex items-center gap-2 text-sm text-alphi-muted">
              <TypingDots />
              <span>Cargando mensajes...</span>
            </div>
          )}

          {turns.length === 0 && !isLoadingMessages && !isSending && (
            <EmptyState studyName={studyName} protocolNumber={protocolNumber} />
          )}

          {turns.map((turn) => (
            <ChatMessage
              key={turn.messageId}
              turn={turn}
              isStreaming={turn.messageId === streamingTurnId}
              highlightEvidenceIdx={highlightIdx}
              onFootnoteClick={(idx) => {
                setHighlightIdx(idx)
                setTimeout(() => {
                  document.getElementById(`evidence-${idx}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
                }, 50)
              }}
            />
          ))}

          {/* Show dots only during retrieval phase (isSending but not yet streaming) */}
          {isSending && !streamingTurnId && (
            <div className="flex items-start gap-3">
              <AlphiAvatar />
              <div className="alphi-card flex items-center gap-1.5 px-4 py-3 text-alphi-muted">
                <TypingDots />
                <span className="ml-1 text-xs">Generando respuesta...</span>
              </div>
            </div>
          )}

          {sendError && (
            <div className="rounded-xl border border-alphi-rose/30 bg-alphi-rose/10 px-4 py-3 text-sm text-alphi-rose">
              {sendError}
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        <div className="border-t border-alphi-border bg-white px-4 py-3">
          <form onSubmit={handleSubmit}>
            <div className="relative">
              <textarea
                ref={textareaRef}
                rows={2}
                className="alphi-input min-h-[64px] max-h-40 resize-none pr-24"
                placeholder="Pregunta sobre criterios, visitas, muestras, medicacion, safety..."
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={handleKeyDown}
              />
              <button
                type="submit"
                disabled={!canSend}
                className="absolute bottom-2 right-2 alphi-btn-primary px-3 py-1.5 text-xs"
              >
                {isSending ? (
                  <span className="flex items-center gap-1.5">
                    <TypingDots />
                    <span>Enviando</span>
                  </span>
                ) : (
                  <span>Enviar</span>
                )}
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {SUGGESTED.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setQuestion(s)}
                  className="inline-flex items-center gap-1 rounded-full border border-alphi-border bg-white px-3 py-1 text-[11px] font-medium text-alphi-muted transition-all duration-100 hover:border-alphi-teal/40 hover:bg-alphi-teal/5 hover:text-alphi-navy"
                >
                  {s}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[10px] text-alphi-muted">
              ALPHI responde solo desde documentos cargados. Verificar siempre con el protocolo original.
            </p>
          </form>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ChatMessage({
  turn,
  isStreaming,
  highlightEvidenceIdx,
  onFootnoteClick,
}: {
  turn: ChatTurn
  isStreaming: boolean
  highlightEvidenceIdx: number | null
  onFootnoteClick: (idx: number) => void
}) {
  if (turn.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[75%] rounded-2xl rounded-tr-md bg-alphi-navy px-4 py-3 text-white shadow-alphi-card">
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{turn.content}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-start gap-3">
      <AlphiAvatar />
      <div className="min-w-0 flex-1">
        <div className="alphi-card px-4 py-3">
          <div className="mb-2.5 flex items-center gap-2">
            <span className="alphi-label">ALPHI</span>
            {turn.confidence && !isStreaming && <ConfidenceBadge confidence={turn.confidence} />}
            {isStreaming && (
              <span className="inline-flex items-center gap-1 text-[11px] text-alphi-teal">
                <TypingDots />
                <span className="ml-0.5">escribiendo</span>
              </span>
            )}
          </div>

          {/* Answer text with streaming cursor */}
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-alphi-navy">
            {turn.content ? (
              <>
                {renderAnswerWithFootnotes(turn.content, turn.evidences, onFootnoteClick)}
                {isStreaming && (
                  <span
                    className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-alphi-teal align-middle"
                    aria-hidden="true"
                  />
                )}
              </>
            ) : (
              isStreaming && (
                <span className="inline-flex items-center gap-1 text-alphi-muted text-xs">
                  <TypingDots />
                  <span className="ml-1">buscando en documentos...</span>
                </span>
              )
            )}
          </div>

          {/* Insufficient evidence notice (only after streaming done) */}
          {!isStreaming && turn.confidence === 'insufficient_evidence' && (
            <div className="mt-3 rounded-lg border border-alphi-amber/30 bg-alphi-amber/10 px-3 py-2 text-xs text-alphi-amber">
              {(turn.retrievalCount ?? 0) === 0
                ? 'No encontre fragmentos relevantes en los documentos indexados para esa pregunta.'
                : 'Fragmentos encontrados pero no alcanzaron el umbral de relevancia. Intenta una pregunta mas especifica.'}
            </div>
          )}

          {/* Evidence cards (only after streaming done) */}
          {!isStreaming && turn.evidences.length > 0 && (
            <EvidenceList evidences={turn.evidences} highlightIndex={highlightEvidenceIdx} />
          )}

          {/* Medical annotation chips (SNOMED-CT + LOINC) */}
          {!isStreaming && turn.annotations && turn.annotations.length > 0 && (
            <MedicalAnnotationChips annotations={turn.annotations} />
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Medical annotation chips
// ---------------------------------------------------------------------------

const MAX_CHIPS_VISIBLE = 6

const SNOMED_BROWSER = 'https://browser.ihtsdotools.org/?perspective=full&conceptId1='
const LOINC_URL      = 'https://loinc.org/'

function chipUrl(ann: MedicalAnnotation): string {
  return ann.system === 'SNOMED-CT'
    ? `${SNOMED_BROWSER}${ann.code}&edition=MAIN`
    : `${LOINC_URL}${ann.code}/`
}

function MedicalChip({ ann }: { ann: MedicalAnnotation }) {
  const isSnomed = ann.system === 'SNOMED-CT'
  return (
    <a
      href={chipUrl(ann)}
      target="_blank"
      rel="noopener noreferrer"
      title={`${ann.system} · ${ann.code}\n${ann.display}`}
      className={[
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-medium',
        'transition-all duration-100 no-underline',
        isSnomed
          ? 'border-alphi-teal/30 bg-alphi-teal/10 text-alphi-teal hover:border-alphi-teal/60 hover:bg-alphi-teal/20'
          : 'border-alphi-sage/30 bg-alphi-sage/10 text-alphi-sage hover:border-alphi-sage/60 hover:bg-alphi-sage/20',
      ].join(' ')}
    >
      <span
        className={[
          'inline-block rounded-sm px-1 py-px text-[8px] font-bold uppercase tracking-wide',
          isSnomed ? 'bg-alphi-teal/20 text-alphi-teal' : 'bg-alphi-sage/25 text-alphi-sage',
        ].join(' ')}
      >
        {isSnomed ? 'SCT' : 'LOINC'}
      </span>
      <span className="max-w-[140px] truncate">{ann.term}</span>
      <span className="opacity-50">{ann.code}</span>
    </a>
  )
}

function MedicalAnnotationChips({ annotations }: { annotations: MedicalAnnotation[] }) {
  const [expanded, setExpanded] = useState(false)

  // Deduplicate by code — same code may appear multiple times from different surface forms
  const deduped = annotations.filter(
    (ann, idx, arr) => arr.findIndex((a) => a.code === ann.code) === idx,
  )

  const visible = expanded ? deduped : deduped.slice(0, MAX_CHIPS_VISIBLE)
  const overflow = deduped.length - MAX_CHIPS_VISIBLE

  return (
    <div className="mt-3 border-t border-alphi-border/50 pt-2.5">
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-alphi-muted">
        Terminología clínica
      </p>
      <div className="flex flex-wrap gap-1.5">
        {visible.map((ann) => (
          <MedicalChip key={`${ann.system}:${ann.code}`} ann={ann} />
        ))}
        {!expanded && overflow > 0 && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="inline-flex items-center rounded-full border border-alphi-border px-2.5 py-0.5 text-[10px] font-medium text-alphi-muted transition-all hover:border-alphi-teal/40 hover:text-alphi-navy"
          >
            +{overflow} más
          </button>
        )}
      </div>
    </div>
  )
}

function EmptyState({ studyName, protocolNumber }: { studyName: string; protocolNumber: string | null }) {
  return (
    <div className="flex h-full flex-col items-center justify-center py-12 text-center">
      <AlphiLogo variant="icon" height={48} />
      <h2 className="mt-4 text-lg font-bold text-alphi-navy">Listo para consultar</h2>
      <p className="mt-1 max-w-sm text-sm text-alphi-muted">
        Haz una pregunta sobre <strong>{studyName}</strong>
        {protocolNumber ? ` (${protocolNumber})` : ''}.
        Cada respuesta viene con cita exacta del documento fuente.
      </p>
      <div className="mt-6 grid max-w-md grid-cols-1 gap-2 sm:grid-cols-2">
        {[
          'Criterios de inclusion y exclusion',
          'Ventanas de visitas del SoA',
          'Medicacion concomitante prohibida',
          'Procesamiento de muestras PK',
          'Timeline de reporte de SAE/SUSAR',
          'Instrucciones de visita especifica',
        ].map((item) => (
          <div key={item} className="flex items-center gap-2 rounded-lg border border-alphi-border bg-white px-3 py-2 text-left">
            <span className="text-xs text-alphi-muted">{item}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function AlphiAvatar() {
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-alphi-navy shadow-alphi-card">
      <AlphiLogo variant="icon" height={20} theme="white" />
    </div>
  )
}

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-0.5 text-alphi-teal">
      <span className="alphi-typing-dot" />
      <span className="alphi-typing-dot" />
      <span className="alphi-typing-dot" />
    </span>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function hydrateMessages(messages: MessageItem[]): Promise<ChatTurn[]> {
  return Promise.all(
    messages.map(async (msg): Promise<ChatTurn> => {
      if (msg.role === 'user') {
        return {
          messageId: msg.messageId,
          role: 'user',
          content: msg.content,
          confidence: null,
          evidences: [],
          retrievalCount: null,
          createdAt: msg.createdAt,
        }
      }
      let evidences: Evidence[] = []
      try { evidences = await fetchMessageCitations(msg.messageId) } catch { evidences = [] }
      return {
        messageId: msg.messageId,
        role: 'assistant',
        content: msg.content,
        confidence: msg.confidence,
        evidences,
        retrievalCount: null,
        createdAt: msg.createdAt,
      }
    }),
  )
}

function upsertConv(convs: ConversationListItem[], studyId: string, convId: string): ConversationListItem[] {
  if (convs.some((c) => c.conversationId === convId)) return convs
  const now = new Date().toISOString()
  return [{ conversationId: convId, studyId, title: null, createdAt: now, updatedAt: now }, ...convs]
}

function formatDate(value: string): string {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString('es', { year: 'numeric', month: 'short', day: '2-digit' })
}

// Named exports required by chat-ui.test.tsx
export function ChatMessageList({ turns }: { turns: ChatTurn[] }) {
  return (
    <div className="space-y-4">
      {turns.map((t) => (
        <ChatMessage key={t.messageId} turn={t} isStreaming={false} highlightEvidenceIdx={null} onFootnoteClick={() => {}} />
      ))}
    </div>
  )
}

export function ChatTransientStatus({ isSending, sendError }: { isSending: boolean; sendError: string | null }) {
  return (
    <div>
      {isSending && (
        <div className="flex items-center gap-2 text-sm text-alphi-muted">
          <TypingDots />
          <span>Generando respuesta...</span>
        </div>
      )}
      {sendError && (
        <p className="rounded-xl border border-alphi-rose/30 bg-alphi-rose/10 p-3 text-sm text-alphi-rose">{sendError}</p>
      )}
    </div>
  )
}
