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
      colors: {
        alphi: {
          navy:    '#0D1F3C',
          navydim: '#162847',
          teal:    '#0891B2',
          teallit: '#E0F2FE',
          sage:    '#059669',
          amber:   '#D97706',
          rose:    '#DC2626',
          slate:   '#F8FAFC',
          border:  '#E2E8F0',
          muted:   '#64748B',
        },
      },
      boxShadow: {
        'alphi-card':  '0 1px 3px 0 rgba(13,31,60,0.08), 0 1px 2px -1px rgba(13,31,60,0.06)',
        'alphi-panel': '0 4px 6px -1px rgba(13,31,60,0.10), 0 2px 4px -2px rgba(13,31,60,0.06)',
        'alphi-modal': '0 20px 25px -5px rgba(13,31,60,0.15), 0 8px 10px -6px rgba(13,31,60,0.10)',
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
