import { describe, expect, it } from 'vitest'
import { specChunkText } from '../../rag/spec-context'
import {
  isUnapprovedSpec,
  unapprovedSpecNotice,
  UNAPPROVED_SPEC_ANSWER_NOTICE,
  UNAPPROVED_SPEC_CONTENT_NOTE,
  withUnapprovedSpecNotice,
} from '../spec-notice'

describe('aviso de protocolo sin aprobar (C5)', () => {
  it('solo `approved` cuenta como aprobado; ante la duda, se avisa', () => {
    expect(isUnapprovedSpec('approved')).toBe(false)
    for (const status of ['draft', 'superseded', 'APPROVED', '', null, undefined]) {
      expect(isUnapprovedSpec(status)).toBe(true)
    }
  })

  it('la pantalla de elegibilidad avisa con la versión del borrador', () => {
    const notice = unapprovedSpecNotice('draft', 3)
    expect(notice).toContain('nadie aprobó todavía')
    expect(notice).toContain('versión 3')
    expect(unapprovedSpecNotice('draft', null)).not.toContain('versión')
  })

  it('con el protocolo aprobado no hay aviso', () => {
    expect(unapprovedSpecNotice('approved', 3)).toBeNull()
  })

  it('el asistente marca la cita y avisa al modelo cuando el protocolo es un borrador', () => {
    const draft = specChunkText('eligibility', 'Inclusión: adultos', 'draft')
    expect(draft.sectionTitle).toContain('BORRADOR SIN APROBAR')
    expect(draft.content.startsWith(UNAPPROVED_SPEC_CONTENT_NOTE)).toBe(true)
    expect(draft.content).toContain('Inclusión: adultos')
  })

  it('con el protocolo aprobado la cita y el contenido quedan como estaban', () => {
    const approved = specChunkText('eligibility', 'Inclusión: adultos', 'approved')
    expect(approved.sectionTitle).not.toContain('BORRADOR')
    expect(approved.content).toBe('Inclusión: adultos')
  })

  it('la respuesta guardada lleva el aviso cuando cita un borrador, una sola vez', () => {
    const draftTitle = specChunkText('eligibility', 'x', 'draft').sectionTitle
    const evidences = [
      { chunkId: '5b1e…', sectionTitle: 'Sección 5.1' },
      { chunkId: 'spec:abc:eligibility', sectionTitle: draftTitle },
    ]
    const first = withUnapprovedSpecNotice('Los criterios son cuatro [2].', evidences)
    expect(first.answer.endsWith(UNAPPROVED_SPEC_ANSWER_NOTICE)).toBe(true)
    expect(first.appended).toContain(UNAPPROVED_SPEC_ANSWER_NOTICE)
    expect(withUnapprovedSpecNotice(first.answer, evidences)).toEqual({ answer: first.answer, appended: '' })
  })

  it('sin cita de borrador, o con el protocolo aprobado, la respuesta no cambia', () => {
    const approvedTitle = specChunkText('eligibility', 'x', 'approved').sectionTitle
    expect(withUnapprovedSpecNotice('Texto.', [{ chunkId: '5b1e…', sectionTitle: 'Sección 5.1' }]).appended).toBe('')
    expect(withUnapprovedSpecNotice('Texto.', [{ chunkId: 'spec:abc:eligibility', sectionTitle: approvedTitle }]).appended).toBe('')
    expect(withUnapprovedSpecNotice('', [{ chunkId: 'spec:abc:eligibility', sectionTitle: specChunkText('visits', 'x', 'draft').sectionTitle }]).appended).toBe('')
  })
})
