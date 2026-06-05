import Link from 'next/link'
import { OrganizationSwitcher, UserButton } from '@clerk/nextjs'

/**
 * Layout autenticado. El middleware ya garantizó sesión; cada sesión opera
 * dentro de una organización activa (Clerk OrganizationSwitcher).
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-4">
          <Link href="/dashboard" className="font-semibold">
            Ichtys
          </Link>
          <OrganizationSwitcher hidePersonal />
        </div>
        <UserButton />
      </header>
      <main className="flex-1 p-4">{children}</main>
    </div>
  )
}
