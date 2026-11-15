import { describe, expect, it } from 'vitest'
import { specChunkText } from '../../rag/spec-context'
import {
  isUnapprovedSpec,
  unapprovedSpecNotice,
  UNAPPROVED_SPEC_ANSWER_NOTICE,
  UNAPPROVED_SPEC_CONTENT_NOTE,
  withUnapprovedSpecNotice,
  newerDraftNotice,
  pendingSpecApproval,
  specPendingApprovalNotice,
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

describe('pendingSpecApproval — ¿hay un protocolo extraído esperando aprobación? (C5)', () => {
  const row = (version: number, status: string) => ({ version, status })

  it('sin aprobado y con borrador: espera, y dice cuál', () => {
    expect(pendingSpecApproval(null, row(2, 'draft'))).toEqual({ pending: true, version: 2 })
  })

  it('sin nada extraído: no espera nada', () => {
    expect(pendingSpecApproval(null, null)).toEqual({ pending: false, version: null })
    expect(pendingSpecApproval(undefined, undefined)).toEqual({ pending: false, version: null })
  })

  it('aprobado y un borrador más nuevo: espera el borrador', () => {
    expect(pendingSpecApproval(row(1, 'approved'), row(2, 'draft'))).toEqual({ pending: true, version: 2 })
  })

  it('aprobado y el último es ese mismo: no espera nada', () => {
    expect(pendingSpecApproval(row(3, 'approved'), row(3, 'approved'))).toEqual({ pending: false, version: null })
  })

  it('un borrador más viejo que el aprobado no cuenta', () => {
    expect(pendingSpecApproval(row(3, 'approved'), row(2, 'draft'))).toEqual({ pending: false, version: null })
  })

  it('una versión reemplazada no es un borrador esperando', () => {
    expect(pendingSpecApproval(null, row(2, 'superseded'))).toEqual({ pending: false, version: null })
  })
})

describe('textos de la pantalla (C5)', () => {
  it('sin aprobado: dice que no se evalúa, qué versión espera y dónde se aprueba', () => {
    const text = specPendingApprovalNotice(2)
    expect(text).toContain('no se evalúa')
    expect(text).toContain('versión 2')
    expect(text).toContain('pestaña Spec')
  })

  it('con borrador más nuevo: dice cuál se usa y cuál no', () => {
    expect(newerDraftNotice(1, 2)).toBe('Esta evaluación usa la versión 1, aprobada. Hay una versión más nueva (la 2), extraída y sin aprobar: no se usa hasta que alguien la apruebe.')
  })
})
