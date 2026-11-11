/** Nombre visible del producto. Único lugar donde se define. */
export const OS_NAME = 'Clinical Research OS'

export type NavIcon =
  | 'home'
  | 'calendar'
  | 'users'
  | 'book'
  | 'flask'
  | 'message'
  | 'layers'
  | 'plane'
  | 'link'
  | 'chart'
  | 'library'
  | 'gauge'
  | 'settings'

export interface NavItem {
  href: string
  label: string
  icon: NavIcon
  group: 'main' | 'config'
  /** Módulo que todavía no existe: se muestra con la etiqueta "Próximamente". */
  soon?: boolean
}

export const OS_NAV: NavItem[] = [
  { href: '/inicio', label: 'Inicio', icon: 'home', group: 'main' },
  { href: '/agenda', label: 'Agenda', icon: 'calendar', group: 'main', soon: true },
  { href: '/visitas', label: 'Visitas', icon: 'users', group: 'main', soon: true },
  { href: '/studies', label: 'Protocolos', icon: 'book', group: 'main' },
  { href: '/laboratorios', label: 'Laboratorios', icon: 'flask', group: 'main' },
  { href: '/queries', label: 'Queries', icon: 'message', group: 'main' },
  { href: '/operacion', label: 'Operación', icon: 'layers', group: 'main' },
  { href: '/viaticos', label: 'Viáticos', icon: 'plane', group: 'main' },
  { href: '/integraciones', label: 'Integraciones', icon: 'link', group: 'main' },
  { href: '/metricas', label: 'Métricas', icon: 'chart', group: 'main', soon: true },
  { href: '/library', label: 'Librería', icon: 'library', group: 'config' },
  { href: '/usage', label: 'Consumo', icon: 'gauge', group: 'config' },
  { href: '/settings', label: 'Ajustes', icon: 'settings', group: 'config' },
]

/** Un ítem está activo en su ruta y en todo lo que cuelga de ella. */
export function isNavActive(item: NavItem, pathname: string): boolean {
  return pathname === item.href || pathname.startsWith(`${item.href}/`)
}
