import type { NextConfig } from 'next'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const monorepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * Security headers globales (SECURITY.md — capa Edge).
 * CSP completa con nonces queda pendiente de validación en staging con Clerk;
 * frame-ancestors 'none' ya bloquea clickjacking sin riesgo de romper la app.
 */
const securityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
]

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ]
  },
  // Solo en local: evita que Next tome ~/package-lock.json como workspace root.
  // En Vercel rompe el file tracing y falla con "next-server/server.runtime.prod.js".
  ...(process.env.VERCEL ? {} : { outputFileTracingRoot: monorepoRoot }),
  // Los packages del monorepo se transpilan desde TS directamente.
  transpilePackages: [
    '@ichtys/db',
    '@ichtys/auth',
    '@ichtys/clinical',
    '@ichtys/crypto',
    '@ichtys/ingestion',
    '@ichtys/llm',
    '@ichtys/rag',
    '@ichtys/ui',
  ],
  serverExternalPackages: ['@neondatabase/serverless', 'ws', 'pdf-parse', 'pdfjs-dist'],
  // Turbopack (default builder desde Next 16) no tiene equivalente al externals
  // hack de webpack de abajo; turbopack:{} reconoce explícitamente que el webpack
  // config es intencional y solo aplica bajo webpack, sin bloquear el build.
  turbopack: {},
  webpack: (config, { isServer }) => {
    if (isServer) {
      // pdfjs-dist rompe cuando webpack lo bundlea desde un transpilePackage:
      // el worker (pdf.worker.mjs) queda en vendor-chunks con un path relativo incorrecto.
      // Forzarlo como external hace que Node.js lo cargue directamente en runtime.
      const existingExternals = Array.isArray(config.externals) ? config.externals : []
      config.externals = [
        ...existingExternals,
        ({ request }: { request?: string }, callback: (err?: null, result?: string) => void) => {
          if (request && (request === 'pdfjs-dist' || request.startsWith('pdfjs-dist/'))) {
            callback(null, `commonjs ${request}`)
          } else {
            callback()
          }
        },
      ]
    }
    return config
  },
}

export default nextConfig
