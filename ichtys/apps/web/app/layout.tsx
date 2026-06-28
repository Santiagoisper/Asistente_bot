import type { Metadata } from 'next'
import { ClerkProvider } from '@clerk/nextjs'
import './globals.css'

export const metadata: Metadata = {
  title: 'ALPHI - Clinical Document Intelligence',
  description: 'Asistente documental clinico con respuestas grounded y citas exactas al documento fuente.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="es">
        <body className="min-h-screen bg-alphi-slate text-alphi-navy antialiased font-sans">
          {children}
        </body>
      </html>
    </ClerkProvider>
  )
}
