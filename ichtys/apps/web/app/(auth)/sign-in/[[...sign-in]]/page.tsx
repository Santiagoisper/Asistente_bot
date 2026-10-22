import { SignIn } from '@clerk/nextjs'

export default function SignInPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <SignIn fallbackRedirectUrl="/dashboard" signUpFallbackRedirectUrl="/dashboard" />
    </main>
  )
}
