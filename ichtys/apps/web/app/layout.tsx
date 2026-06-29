import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { ClerkProvider } from '@clerk/nextjs'
import './globals.css'

// Inter cargada como fuente web — los font-feature-settings (cv02..cv11) de
// globals.css ya estaban pensados para Inter. Variable CSS para Tailwind.
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
})

export const metadata: Metadata = {
  title: 'ALPHI - Clinical Document Intelligence',
  description: 'Asistente documental clinico con respuestas grounded y citas exactas al documento fuente.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="es" className={inter.variable}>
        <body className="min-h-screen bg-alphi-slate text-alphi-navy antialiased font-sans">
          {children}
        </body>
      </html>
    </ClerkProvider>
  )
}
