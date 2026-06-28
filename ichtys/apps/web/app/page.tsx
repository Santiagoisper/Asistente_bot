import { redirect } from 'next/navigation'

/**
 * Root route — redirects to /dashboard.
 * Clerk lands here after sign-in when NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL is unset.
 */
export default function RootPage() {
  redirect('/dashboard')
}
