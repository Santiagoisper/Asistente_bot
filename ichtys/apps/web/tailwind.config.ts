import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './pages/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'var(--font-sans)',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
      },
      // Fuente única de verdad: tokens de app/globals.css (:root).
      // `teal` conserva el nombre histórico por compatibilidad con las clases
      // existentes, pero porta el acento violeta de la paleta consolidada.
      colors: {
        alphi: {
          navy:        '#192337',
          navydim:     '#222C42',
          teal:        '#6855B6',
          teallit:     '#F1EDFA',
          sage:        '#059669',
          amber:       '#D97706',
          rose:        '#DC2626',
          slate:       '#F7F8FC',
          border:      '#E5E8F0',
          muted:       '#667085',
          'violet-soft': '#F1EDFA',
          'green-soft':  '#E9F7F0',
          'blue-soft':   '#EAF3FC',
          'amber-soft':  '#FFF4E2',
          'rose-soft':   '#FCEEF1',
        },
      },
      boxShadow: {
        'alphi-card':  '0 1px 3px 0 rgba(25,35,55,0.08), 0 1px 2px -1px rgba(25,35,55,0.06)',
        'alphi-panel': '0 4px 6px -1px rgba(25,35,55,0.10), 0 2px 4px -2px rgba(25,35,55,0.06)',
        'alphi-modal': '0 20px 25px -5px rgba(25,35,55,0.15), 0 8px 10px -6px rgba(25,35,55,0.10)',
      },
      keyframes: {
        pulseDot: {
          '0%, 80%, 100%': { opacity: '0.2', transform: 'scale(0.8)' },
          '40%':           { opacity: '1',   transform: 'scale(1)' },
        },
        fadeIn: {
          from: { opacity: '0' },
          to:   { opacity: '1' },
        },
        slideUp: {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'pulse-dot': 'pulseDot 1.4s ease-in-out infinite',
        'fade-in':   'fadeIn 0.2s ease-out',
        'slide-up':  'slideUp 0.25s ease-out',
      },
    },
  },
  plugins: [],
}

export default config
