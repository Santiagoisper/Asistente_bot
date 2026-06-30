/**
 * Debe importarse ANTES que `ws` en client.ts.
 * En ESM los imports se resuelven en orden; este módulo no tiene dependencias,
 * así que su cuerpo corre antes de que `ws` intente cargar bufferutil.
 */
if (!process.env.WS_NO_BUFFER_UTIL) {
  process.env.WS_NO_BUFFER_UTIL = 'true'
}
if (!process.env.WS_NO_UTF_8_VALIDATE) {
  process.env.WS_NO_UTF_8_VALIDATE = 'true'
}

export {}
