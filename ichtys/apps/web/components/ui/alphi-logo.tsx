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
 * Mark: asistente IA clínico — cabeza de robot con cruz médica y pulso de datos.
 * Producto de ICHTYS TECHNOLOGY SA (https://www.ichtys.com.ar/)
 */
export function AlphiLogo({ variant = 'full', height = 32, theme = 'light', className = '' }: AlphiLogoProps) {
  const navyColor = theme === 'white' ? '#FFFFFF' : '#0D1F3C'
  const tealColor = theme === 'dark' ? '#38BDF8' : '#0891B2'
  const textColor = theme === 'white' ? '#FFFFFF' : '#0D1F3C'

  const iconWidth = height
  const iconHeight = height
  const fullWidth = variant === 'full' ? height * 4.2 : variant === 'icon' ? height : height * 3.0

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
        <AlphiRobotMark navy={navyColor} teal={tealColor} theme={theme} />
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
      <AlphiRobotMark navy={navyColor} teal={tealColor} theme={theme} />
      <g transform="translate(50, 4)">
        <AlphiWordmark color={textColor} teal={tealColor} />
      </g>
    </svg>
  )
}

function AlphiRobotMark({
  navy,
  teal,
  theme,
}: {
  navy: string
  teal: string
  theme: 'light' | 'dark' | 'white'
}) {
  const faceFill = theme === 'white' ? '#162847' : '#FFFFFF'
  const faceStroke = theme === 'white' ? '#FFFFFF' : navy
  const eyeFill = teal

  return (
    <>
      {/* Background */}
      <rect width="40" height="40" rx="10" fill={navy} />

      {/* Antenna */}
      <line x1="20" y1="6" x2="20" y2="10" stroke={teal} strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="20" cy="5" r="2" fill={teal} />

      {/* Head */}
      <rect x="10" y="10" width="20" height="16" rx="5" fill={faceFill} stroke={faceStroke} strokeWidth="1.2" strokeOpacity="0.15" />

      {/* Visor / eyes */}
      <rect x="13.5" y="15" width="5" height="4" rx="1.2" fill={eyeFill} opacity="0.9" />
      <rect x="21.5" y="15" width="5" height="4" rx="1.2" fill={eyeFill} opacity="0.9" />
      <circle cx="16" cy="17" r="0.8" fill={faceFill} />
      <circle cx="24" cy="17" r="0.8" fill={faceFill} />

      {/* Smile indicator — data line */}
      <path d="M15 23.5 Q20 26 25 23.5" stroke={teal} strokeWidth="1.4" strokeLinecap="round" fill="none" opacity="0.85" />

      {/* Medical cross on chest */}
      <rect x="18.2" y="28.5" width="3.6" height="1.2" rx="0.4" fill={teal} />
      <rect x="19.4" y="27.3" width="1.2" height="3.6" rx="0.4" fill={teal} />

      {/* Side ear modules — sensors */}
      <rect x="7.5" y="16" width="2.2" height="5" rx="1" fill={teal} opacity="0.55" />
      <rect x="30.3" y="16" width="2.2" height="5" rx="1" fill={teal} opacity="0.55" />
    </>
  )
}

function AlphiWordmark({ color, teal }: { color: string; teal: string }) {
  return (
    <>
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
