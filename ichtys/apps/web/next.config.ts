import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Los packages del monorepo se transpilan desde TS directamente.
  transpilePackages: [
    '@ichtys/db',
    '@ichtys/auth',
    '@ichtys/ingestion',
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
