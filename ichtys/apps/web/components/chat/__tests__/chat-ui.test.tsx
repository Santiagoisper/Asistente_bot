import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import ChatClient, { ChatMessageList, ChatTransientStatus } from '../chat-client'
import { EvidenceCard } from '../evidence-list'
import type { ChatTurn, Evidence } from '../types'

const STUDY_ID = '11111111-1111-4111-8111-111111111111'
const DOCUMENT_VERSION_ID = '55555555-5555-4555-8555-555555555555'

function render(element: React.ReactElement): string {
  return renderToStaticMarkup(element)
}

function makeEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    chunkId: 'chunk-1',
    documentId: 'document-1',
    documentVersionId: DOCUMENT_VERSION_ID,
    documentName: 'Protocol v2',
    documentType: 'protocol',
    pageStart: 12,
    pageEnd: 14,
    sectionTitle: 'Eligibility',
    excerpt: 'Participants must meet all inclusion criteria before randomization.',
    ...overrides,
  }
}

describe('minimal chat UI render', () => {
  it('renders the chat screen with studyId and composer', () => {
    const html = render(
      <ChatClient studyId={STUDY_ID} studyName="Study Alpha" protocolNumber="ALPHA-01" />,
    )

    expect(html).toContain('Study Alpha')
    expect(html).toContain(`Study ID: ${STUDY_ID}`)
    expect(html).toContain('Protocolo ALPHA-01')
    expect(html).toContain('Cargando historial...')
    expect(html).toContain('Enviar')
  })

  it('renders answer, confidence and evidence metadata', () => {
    const turns: ChatTurn[] = [
      {
        messageId: 'assistant-1',
        role: 'assistant',
        content: 'The protocol requires screening before randomization.',
        confidence: 'high',
        evidences: [makeEvidence()],
      },
    ]

    const html = render(<ChatMessageList turns={turns} />)

    expect(html).toContain('The protocol requires screening before randomization.')
    expect(html).toContain('Confianza alta')
    expect(html).toContain('Protocol v2')
    expect(html).toContain('pp. 12-14')
    expect(html).toContain('Eligibility')
    expect(html).toContain('Participants must meet all inclusion criteria before randomization.')
  })

  it('visually truncates long excerpts without changing the excerpt payload', () => {
    const longExcerpt = 'A'.repeat(900)
    const html = render(<EvidenceCard evidence={makeEvidence({ excerpt: longExcerpt })} />)

    expect(html).toContain('max-h-24')
    expect(html).toContain('overflow-hidden')
    expect(html).toContain(`data-full-excerpt="${longExcerpt}"`)
    expect(html).toContain(longExcerpt)
  })

  it('renders insufficient evidence without false citations', () => {
    const turns: ChatTurn[] = [
      {
        messageId: 'assistant-1',
        role: 'assistant',
        content: 'No hay informacion suficiente en los documentos disponibles.',
        confidence: 'insufficient_evidence',
        evidences: [],
      },
    ]

    const html = render(<ChatMessageList turns={turns} />)

    expect(html).toContain('Evidencia insuficiente')
    expect(html).toContain('Sin evidencia suficiente en los documentos disponibles.')
    expect(html).not.toContain('Abrir PDF fuente')
    expect(html).not.toContain('/api/document-versions/')
  })

  it('uses the private PDF download link in a new tab', () => {
    const html = render(<EvidenceCard evidence={makeEvidence()} />)

    expect(html).toContain(`/api/document-versions/${DOCUMENT_VERSION_ID}/download`)
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noreferrer"')
    expect(html).not.toContain('blob.vercel-storage.com')
  })

  it('does not render prompts, embeddings or raw chunk fields', () => {
    const html = render(<EvidenceCard evidence={makeEvidence()} />)

    expect(html).not.toContain('SYSTEM_PROMPT')
    expect(html).not.toContain('embedding')
    expect(html).not.toContain('chunkId')
  })

  it('renders loading and safe endpoint error states', () => {
    const html = render(
      <ChatTransientStatus
        isSending
        sendError="No se pudo completar la operacion. Intenta nuevamente."
      />,
    )

    expect(html).toContain('Generando respuesta...')
    expect(html).toContain('No se pudo completar la operacion. Intenta nuevamente.')
    expect(html).not.toContain('stack')
    expect(html).not.toContain('Internal')
  })
})
