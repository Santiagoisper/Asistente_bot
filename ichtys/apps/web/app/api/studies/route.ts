import { z } from 'zod'
import { auth } from '@clerk/nextjs/server'
import { db, studies } from '@ichtys/db'
import { handleApiError, resolveOrProvisionOrganization } from '@ichtys/auth'

export const runtime = 'nodejs'

const createStudyInput = z.object({
  name: z.string().min(1).max(200),
  protocolNumber: z.string().max(100).optional(),
})

export async function POST(req: Request): Promise<Response> {
  const { userId, orgId: clerkOrgId } = await auth()
  if (!userId || !clerkOrgId) {
    return new Response('Unauthorized', { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return new Response('Bad Request', { status: 400 })
  }

  const parsed = createStudyInput.safeParse(body)
  if (!parsed.success) {
    return new Response('Bad Request', { status: 400 })
  }

  try {
    const org = await resolveOrProvisionOrganization(clerkOrgId)
    if (!org) throw new Error('Failed to provision organization')

    const [study] = await db
      .insert(studies)
      .values({
        organizationId: org.id,
        name: parsed.data.name,
        protocolNumber: parsed.data.protocolNumber ?? null,
        status: 'active',
      })
      .returning()

    if (!study) throw new Error('Insert did not return a row')

    return Response.json(
      { id: study.id, name: study.name, protocolNumber: study.protocolNumber, status: study.status },
      { status: 201 },
    )
  } catch (err) {
    return handleApiError(err)
  }
}
