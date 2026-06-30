/**
 * Hook de arranque de Next.js — corre antes de cargar rutas/API.
 * Garantiza que Neon Pool/WebSocket no intente usar bufferutil roto en dev local.
 */
export async function register() {
  if (!process.env.WS_NO_BUFFER_UTIL) {
    process.env.WS_NO_BUFFER_UTIL = 'true'
  }
  if (!process.env.WS_NO_UTF_8_VALIDATE) {
    process.env.WS_NO_UTF_8_VALIDATE = 'true'
  }

  if (process.env.NODE_ENV === 'development' && !process.env.GROQ_API_KEY?.trim() && !process.env.OPENAI_API_KEY?.trim()) {
    console.warn(
      '[ichtys] GROQ_API_KEY (o OPENAI_API_KEY) no está configurada — la ingesta fallará en embeddings.',
    )
  }
}
