import React from 'react'

interface AlphiLogoProps {
  /** 'full' = wordmark + icon | 'icon' = solo ícono | 'wordmark' = solo texto */
  variant?: 'full' | 'icon' | 'wordmark'
  /** Height in px — width scales proportionally */
  height?: number
  /** Color scheme */
  theme?: 'light' | 'dark' | 'white'
  className?: string
}

/**
 * ALPHI — Clinical Document Intelligence
 *
 * Mark: α helix estilizado formado por dos arcos que encierran un punto
 * central (representa la partícula alpha de la estadística clínica y el
 * helix del ADN). Azul navy + acento teal.
 */
export function AlphiLogo({ variant = 'full', height = 32, theme = 'light', className = '' }: AlphiLogoProps) {
  const navyColor  = theme === 'white' ? '#FFFFFF' : '#0D1F3C'
  const tealColor  = theme === 'dark'  ? '#38BDF8' : '#0891B2'
  const textColor  = theme === 'white' ? '#FFFFFF' : '#0D1F3C'

  const iconWidth  = height
  const iconHeight = height
  const fullWidth  = variant === 'full' ? height * 4.2 : variant === 'icon' ? height : height * 3.0

  if (variant === 'icon') {
    return (
      <svg
        width={iconWidth}
        height={iconHeight}
        viewBox="0 0 40 40"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
        aria-label="ALPHI"
        role="img"
      >
        <AlphiMark navy={navyColor} teal={tealColor} />
      </svg>
    )
  }

  if (variant === 'wordmark') {
    return (
      <svg
        width={fullWidth}
        height={height}
        viewBox="0 0 126 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
        aria-label="ALPHI"
        role="img"
      >
        <AlphiWordmark color={textColor} teal={tealColor} />
      </svg>
    )
  }

  // full
  return (
    <svg
      width={fullWidth}
      height={height}
      viewBox="0 0 168 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="ALPHI — Clinical Document Intelligence"
      role="img"
    >
      <AlphiMark navy={navyColor} teal={tealColor} />
      <g transform="translate(50, 4)">
        <AlphiWordmark color={textColor} teal={tealColor} />
      </g>
    </svg>
  )
}

function AlphiMark({ navy, teal }: { navy: string; teal: string }) {
  return (
    <>
      {/* Background pill */}
      <rect width="40" height="40" rx="10" fill={navy} />

      {/* α mark — two arcs forming the alpha letter, abstracted as clinical precision */}
      {/* Left arc */}
      <path
        d="M 13 26 C 10 22 10 14 16 11 C 19 9.5 22 10 24 12"
        stroke={teal}
        strokeWidth="2.8"
        strokeLinecap="round"
        fill="none"
      />
      {/* Right arc / descender */}
      <path
        d="M 24 12 C 27 15 27.5 21 25 25 C 23 28 20 29 17 27"
        stroke="#FFFFFF"
        strokeWidth="2.8"
        strokeLinecap="round"
        fill="none"
        strokeOpacity="0.85"
      />
      {/* Descender tail */}
      <path
        d="M 24 12 L 28 28"
        stroke={teal}
        strokeWidth="2.8"
        strokeLinecap="round"
      />
      {/* Center dot — data point / precision */}
      <circle cx="20" cy="19.5" r="2.2" fill={teal} />
    </>
  )
}

function AlphiWordmark({ color, teal }: { color: string; teal: string }) {
  return (
    <>
      {/* ALPHI lettering — using SVG text for crispness */}
      <text
        x="0"
        y="24"
        fontFamily="Inter, system-ui, -apple-system, sans-serif"
        fontSize="26"
        fontWeight="800"
        letterSpacing="-0.5"
        fill={color}
      >
        ALPH
      </text>
      <text
        x="82"
        y="24"
        fontFamily="Inter, system-ui, -apple-system, sans-serif"
        fontSize="26"
        fontWeight="800"
        letterSpacing="-0.5"
        fill={teal}
      >
        I
      </text>
      {/* Tagline */}
      <text
        x="1"
        y="34"
        fontFamily="Inter, system-ui, -apple-system, sans-serif"
        fontSize="8"
        fontWeight="500"
        letterSpacing="1.5"
        fill={color}
        opacity="0.45"
      >
        CLINICAL INTELLIGENCE
      </text>
    </>
  )
}
