/**
 * Copia al portapapeles un texto que todavía se está pidiendo al servidor.
 *
 * Safari solo deja escribir dentro del clic, así que se le entrega la promesa.
 * Si el navegador niega la API moderna (permiso denegado, política del sitio,
 * página embebida) se copia desde un campo oculto. Devuelve si se copió.
 */
export async function copyText(source: Promise<string>): Promise<boolean> {
  try {
    if (typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard?.write === 'function') {
      const blob = source.then((text) => new Blob([text], { type: 'text/plain' }))
      // Si el navegador rechaza la escritura sin llegar a usar la promesa, que no quede un error suelto.
      blob.catch(() => undefined)
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })])
      return true
    }
  } catch {
    // Sigue con las otras formas.
  }

  let text: string
  try {
    text = await source
  } catch {
    return false
  }
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Sigue con el campo oculto.
  }

  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.setAttribute('aria-hidden', 'true')
  area.style.position = 'fixed'
  area.style.top = '0'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.select()
  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    area.remove()
  }
}
