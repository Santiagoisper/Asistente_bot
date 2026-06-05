import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'

/**
 * Auth guard global (ARCHITECTURE.md → Middleware de auth).
 * Todo es privado salvo las rutas públicas de auth. La protección server-side
 * por org/study ocurre además en cada API route vía validateStudyAccess().
 */
const isPublicRoute = createRouteMatcher(['/sign-in(.*)', '/sign-up(.*)'])

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect()
  }
})

export const config = {
  matcher: [
    // Saltea archivos estáticos e internos de Next, corre en todo lo demás.
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
}
