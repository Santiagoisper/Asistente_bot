/**
 * zodIssuesForResponse — acota lo que sale en un 400 de validación
 * (H7 vuelta 3: el PATCH de spec llegó a devolver 18 MB de issues).
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { zodIssuesForResponse } from '../zod-issues'
import { MAX_ISSUES_IN_RESPONSE } from '../limits'

const schema = z.object({ items: z.array(z.string().max(3)) })

function errorWith(n: number) {
  const parsed = schema.safeParse({ items: Array.from({ length: n }, () => 'demasiado-largo') })
  if (parsed.success) throw new Error('el fixture debía fallar')
  return parsed.error
}

describe('zodIssuesForResponse', () => {
  it('devuelve a lo sumo 10 issues con código y ruta, nunca mensaje ni valor recibido', () => {
    const out = zodIssuesForResponse(errorWith(50))
    expect(out.totalIssues).toBe(50)
    expect(out.issues).toHaveLength(MAX_ISSUES_IN_RESPONSE)
    expect(out.issues[0]).toEqual({ path: 'items.0', code: 'too_big' })
    // Sin texto del usuario ni mensajes de zod.
    expect(JSON.stringify(out)).not.toContain('demasiado-largo')
  })

  it('con menos de 10 issues los devuelve todos', () => {
    const out = zodIssuesForResponse(errorWith(3))
    expect(out.totalIssues).toBe(3)
    expect(out.issues).toHaveLength(3)
  })
})
