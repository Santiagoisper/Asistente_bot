import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    '../../packages/ui/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      // Mobile-first (PRD §11): los coordinadores usan el producto en el piso.
    },
  },
  plugins: [],
}

export default config
