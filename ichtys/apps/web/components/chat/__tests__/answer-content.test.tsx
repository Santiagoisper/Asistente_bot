import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { AnswerContent, prepareAnswerMarkdown } from '../answer-content'
import type { Evidence } from '../types'

function makeEvidence(): Evidence {
  return {
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
  it('convierte citas [n] válidas en links internos', () => {
    expect(prepareAnswerMarkdown('Plazo de 24 horas [1] y seguimiento [2].', 2)).toBe(
      'Plazo de 24 horas [1](#alphi-fn-1) y seguimiento [2](#alphi-fn-2).',
    )
  })

  it('deja intactas citas fuera de rango', () => {
    expect(prepareAnswerMarkdown('Referencia [9] sin evidencia.', 2)).toBe(
      'Referencia [9] sin evidencia.',
    )
  })
})

describe('AnswerContent', () => {
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
})
