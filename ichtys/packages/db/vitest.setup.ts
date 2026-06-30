process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://test:test@localhost:5432/test?sslmode=disable'
process.env.ORG_LLM_KEYS_ENCRYPTION_SECRET =
  process.env.ORG_LLM_KEYS_ENCRYPTION_SECRET ?? 'test-secret-for-vitest-only'
