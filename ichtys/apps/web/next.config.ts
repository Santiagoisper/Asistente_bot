import type { NextConfig } from 'next'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const monorepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Solo en local: evita que Next tome ~/package-lock.json como workspace root.
  // En Vercel rompe el file tracing y falla con "next-server/server.runtime.prod.js".
  ...(process.env.VERCEL ? {} : { outputFileTracingRoot: monorepoRoot }),
  // Los packages del monorepo se transpilan desde TS directamente.
  transpilePackages: [
    '@ichtys/db',
    '@ichtys/auth',
    '@ichtys/crypto',
    '@ichtys/ingestion',
    '@ichtys/llm',
    '@ichtys/rag',
    '@ichtys/ui',
  ],
  serverExternalPackages: ['@neondatabase/serverless', 'ws', 'pdf-parse', 'pdfjs-dist'],
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
