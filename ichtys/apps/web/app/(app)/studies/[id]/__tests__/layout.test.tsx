import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// El mock de @ichtys/auth expone SOLO el validador y su error. Si el layout
// vuelve a pedir cualquier otra cosa del paquete (por ejemplo, una consulta
// del estudio sin límite de organización), la importación da undefined y la
// prueba falla al llamarla.
const { validateStudyAccess, AccessError } = vi.hoisted(() => {
  class AccessError extends Error {
    status: number
    constructor(message: string, status: number) {
      super(message)
      this.status = status
    }
  }
  return { validateStudyAccess: vi.fn(), AccessError }
})

vi.mock('@ichtys/auth', () => ({ validateStudyAccess, AccessError }))
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a>,
}))
vi.mock('../../../../../components/ui/study-nav', () => ({ StudyNav: () => null }))

import StudyLayout from '../layout'

async function renderNotFound(studyId: string): Promise<string> {
  validateStudyAccess.mockRejectedValueOnce(new AccessError('Study not found or access denied', 404))
  const tree = await StudyLayout({ children: null, params: Promise.resolve({ id: studyId }) })
  return renderToStaticMarkup(tree)
}

describe('layout de estudio: respuesta uniforme ante un estudio que no se puede ver', () => {
  beforeEach(() => {
    validateStudyAccess.mockReset()
  })

  it('no dice si el estudio existe en otra organización', async () => {
    const html = await renderNotFound('11111111-1111-4111-8111-111111111111')

    expect(html).toContain('Estudio no disponible')
    expect(html).toContain('No encontramos este estudio en la organización activa')
    expect(html).not.toContain('pertenece')
    expect(html).not.toContain('otra organización')
  })

  it('devuelve exactamente lo mismo para dos estudios distintos y no consulta nada más que el validador', async () => {
    const first = await renderNotFound('11111111-1111-4111-8111-111111111111')
    const second = await renderNotFound('22222222-2222-4222-8222-222222222222')

    expect(second).toBe(first)
    expect(validateStudyAccess).toHaveBeenCalledTimes(2)
  })

  it('un error que no es 404 no se convierte en «no disponible»', async () => {
    validateStudyAccess.mockRejectedValueOnce(new AccessError('Forbidden', 403))

    await expect(
      StudyLayout({ children: null, params: Promise.resolve({ id: 'x' }) }),
    ).rejects.toMatchObject({ status: 403 })
  })
})
