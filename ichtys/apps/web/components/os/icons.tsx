import {
  BarChart3,
  BookOpen,
  CalendarDays,
  FlaskConical,
  Gauge,
  Home,
  Layers,
  Library,
  Link2,
  MessageSquare,
  Plane,
  Settings,
  Users,
  type LucideIcon,
} from 'lucide-react'
import type { NavIcon } from '../../lib/os/nav'

const ICONS: Record<NavIcon, LucideIcon> = {
  home: Home,
  calendar: CalendarDays,
  users: Users,
  book: BookOpen,
  flask: FlaskConical,
  message: MessageSquare,
  layers: Layers,
  plane: Plane,
  link: Link2,
  chart: BarChart3,
  library: Library,
  gauge: Gauge,
  settings: Settings,
}

export function NavGlyph({ icon, className }: { icon: NavIcon; className?: string }) {
  const Icon = ICONS[icon]
  return <Icon aria-hidden="true" className={className ?? 'h-5 w-5'} strokeWidth={1.75} />
}

/** Marca del producto: tres trazos inclinados. */
export function OsMark({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 26 22" className={className ?? 'h-5 w-6'} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
      <path d="M3 19 9 4M10 19 16 4M17 19 23 4" />
    </svg>
  )
}
