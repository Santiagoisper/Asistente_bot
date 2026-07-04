import Image from 'next/image'
import Link from 'next/link'

interface IchtysLogoProps {
  height?: number
  className?: string
  /** Link to corporate site (default https://www.ichtys.com.ar/) */
  href?: string
  showLink?: boolean
}

/**
 * ICHTYS TECHNOLOGY SA — corporate mark from https://www.ichtys.com.ar/
 * ALPHI is a product of Ichtys.
 */
export function IchtysLogo({
  height = 28,
  className = '',
  href = 'https://www.ichtys.com.ar/',
  showLink = true,
}: IchtysLogoProps) {
  const img = (
    <Image
      src="/brands/ichtys-logo.png"
      alt="ICHtYS Technology"
      width={Math.round(height * 3.2)}
      height={height}
      className={className}
      style={{ width: 'auto', height }}
      priority
    />
  )

  if (!showLink) return img

  return (
    <Link
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex shrink-0 items-center"
      title="ICHtYS Technology SA"
    >
      {img}
    </Link>
  )
}
