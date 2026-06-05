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
  experimental: {
    // Mantener deps server-only fuera del bundle del cliente.
    serverComponentsExternalPackages: ['postgres', 'pdf-parse'],
  },
}

export default nextConfig
