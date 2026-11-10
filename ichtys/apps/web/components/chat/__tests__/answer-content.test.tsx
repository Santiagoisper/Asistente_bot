// @vitest-environment happy-dom
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
import React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { AnswerContent, prepareAnswerMarkdown } from '../answer-content'
import { citationEvidencePosition } from '../citation-index'
import type { Evidence } from '../types'

function makeEvidence(): Evidence {
  return {
    citationIndex: 1,
    chunkId: 'chunk-1',
    documentId: 'document-1',
    documentVersionId: '55555555-5555-4555-8555-555555555555',
    documentName: 'Protocol',
    documentType: 'protocol',
    pageStart: 58,
    pageEnd: 60,
    sectionTitle: null,
    excerpt: 'Dentro de las 24 horas desde que se toma conocimiento del EAS.',
  }
}

describe('prepareAnswerMarkdown', () => {
  it('enlaza índices originales aunque estén desordenados o salteados', () => {
    const evidences = [
      { ...makeEvidence(), citationIndex: 7 },
      { ...makeEvidence(), citationIndex: 3 },
    ]
    expect(prepareAnswerMarkdown('Primero [7], luego [3]; inválida [1].', evidences)).toBe(
      'Primero [7](#alphi-fn-7), luego [3](#alphi-fn-3); inválida [1].',
    )
    expect(citationEvidencePosition(evidences, 7)).toBe(0)
    expect(citationEvidencePosition(evidences, 3)).toBe(1)
    expect(citationEvidencePosition(evidences, 1)).toBeNull()
  })

  it('deja intactas citas sin evidencia correspondiente', () => {
    expect(prepareAnswerMarkdown('Referencia [9] sin evidencia.', [makeEvidence()])).toBe(
      'Referencia [9] sin evidencia.',
    )
  })

  it('no enlaza numeración vieja o ambigua', () => {
    const legacy = [{ ...makeEvidence(), citationIndex: null }]
    expect(prepareAnswerMarkdown('Texto [1].', legacy)).toBe('Texto [1].')
    expect(citationEvidencePosition(legacy, 1)).toBeNull()
    const duplicate = [makeEvidence(), makeEvidence()]
    expect(prepareAnswerMarkdown('Texto [1].', duplicate)).toBe('Texto [1].')
  })
})

describe('AnswerContent', () => {
  it('abre la fuente por índice original, no por orden de tarjeta', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    const onFootnoteClick = vi.fn()
    const evidences = [
      { ...makeEvidence(), citationIndex: 7 },
      { ...makeEvidence(), citationIndex: 3 },
    ]

    await act(async () => {
      root.render(
        <AnswerContent text="Primero [7], luego [3] y [1]." evidences={evidences} onFootnoteClick={onFootnoteClick} />,
      )
    })

    const buttons = [...container.querySelectorAll('button.alphi-footnote')]
    expect(buttons.map((button) => button.textContent)).toEqual(['7', '3'])
    buttons[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    buttons[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(onFootnoteClick.mock.calls).toEqual([[0], [1]])
    expect(container.textContent).toContain('[1]')

    await act(async () => root.unmount())
  })

  it('renderiza negritas y botón de cita', () => {
    const html = renderToStaticMarkup(
      <AnswerContent
        text="**Plazo:** dentro de las 24 horas [1]."
        evidences={[makeEvidence()]}
        onFootnoteClick={vi.fn()}
      />,
    )

    expect(html).toContain('<strong')
    expect(html).toContain('Plazo:')
    expect(html).toContain('alphi-footnote')
    expect(html).toContain('Ver fuente 1')
  })

  it('renderiza tablas markdown', () => {
    const html = renderToStaticMarkup(
      <AnswerContent
        text={'| Tipo | Plazo |\n| --- | --- |\n| EAS | 24 horas |'}
        evidences={[]}
        onFootnoteClick={vi.fn()}
      />,
    )

    expect(html).toContain('<table')
    expect(html).toContain('24 horas')
  })

  it('muestra aviso y ninguna nota enlazada para respuestas anteriores al fix', () => {
    const html = renderToStaticMarkup(
      <AnswerContent
        text="Texto [1]."
        evidences={[{ ...makeEvidence(), citationIndex: null }]}
        onFootnoteClick={vi.fn()}
      />,
    )

    expect(html).toContain('Numeración no verificable')
    expect(html).toContain('Texto [1].')
    expect(html).not.toContain('alphi-footnote')
  })

  it('elimina enlaces numéricos preexistentes de historial sin índice verificable', () => {
    const html = renderToStaticMarkup(
      <AnswerContent
        text="Texto [1](#alphi-fn-1)."
        evidences={[{ ...makeEvidence(), citationIndex: null }]}
        onFootnoteClick={vi.fn()}
      />,
    )
    expect(html).toContain('Numeración no verificable')
    expect(html).not.toContain('href="#alphi-fn-1"')
    expect(html).not.toContain('alphi-footnote')
  })

  it('no conserva un enlace externo sobre una cita inválida', () => {
    const html = renderToStaticMarkup(
      <AnswerContent text="Referencia [9](https://example.com)." evidences={[makeEvidence()]} onFootnoteClick={vi.fn()} />,
    )
    expect(html).toContain('Referencia')
    expect(html).not.toContain('href="https://example.com"')
    expect(html).not.toContain('alphi-footnote')
  })
})
