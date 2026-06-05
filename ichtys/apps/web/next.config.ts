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
  // Mantener deps server-only fuera del bundle del cliente (Next 15).
  serverExternalPackages: ['@neondatabase/serverless', 'ws', 'pdf-parse'],
}

export default nextConfig
