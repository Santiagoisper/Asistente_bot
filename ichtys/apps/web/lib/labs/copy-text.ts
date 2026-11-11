/**
 * Copia texto al portapapeles. El navegador puede negar la API moderna (permiso
 * denegado, política del sitio, página embebida): en ese caso se copia desde un
 * campo oculto, que solo necesita el clic de la persona. Devuelve si se copió.
 */
export async function copyText(text: string): Promise<boolean> {
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
