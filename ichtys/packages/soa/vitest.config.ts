import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['__tests__/**/*.test.ts'],
    // P2 corre en Node puro, sin DOM ni canvas: pdfjs-dist legacy no necesita
    // polyfills de navegador para getTextContent/getOperatorList.
    environment: 'node',
  },
})
