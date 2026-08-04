import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'

/**
 * Root route — sends signed-out users to the explicit auth entrypoint instead
 * of bouncing them through a protected dashboard route that ends in a 404.
 */
export default async function RootPage() {
  const { userId } = await auth()

  redirect(userId ? '/dashboard' : '/sign-in')
}
