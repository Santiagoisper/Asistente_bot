import { SignUp } from '@clerk/nextjs'

export default function SignUpPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <SignUp fallbackRedirectUrl="/dashboard" signInFallbackRedirectUrl="/dashboard" />
    </main>
  )
}
