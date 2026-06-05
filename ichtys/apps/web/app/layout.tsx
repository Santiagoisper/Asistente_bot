import type { Metadata } from 'next'
import { ClerkProvider } from '@clerk/nextjs'
import './globals.css'

export const metadata: Metadata = {
  title: 'Ichtys — Clinical Document Assistant',
  description:
    'Asistente documental clínico con respuestas grounded y citas exactas al documento fuente.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <ClerkProvider>
      <html lang="es">
        <body className="min-h-screen bg-white text-gray-900 antialiased">{children}</body>
      </html>
    </ClerkProvider>
  )
}
