/**
 * Prueba, en este equipo, que un formato de grabación se puede grabar **y** decodificar con el
 * mismo decodificador que usa la transcripción (docs/decisions/consulta-dictada.md, D25).
 * Solo en el navegador. No usa el micrófono: graba un tono generado, un instante.
 *
 * Por qué una prueba y no una consulta: `canPlayType` responde por el reproductor y contesta
 * «quizás»; la transcripción decodifica con `decodeAudioData`, que es otra cosa.
 */

/** Cuánto se graba del tono de prueba. El grabador tarda en arrancar: con 350 ms, en un equipo de escritorio quedaron 60 ms de audio. */
const PROBE_MS = 600
/** Si un paso no responde en este tiempo, el formato no se usa. Empezar a grabar no espera más que esto por paso. */
const PROBE_TIMEOUT_MS = 1500

const results = new Map<string, Promise<boolean>>()

/** `true` si este equipo grabó el formato y después lo decodificó. Se prueba una vez por formato. */
export function canDecodeRecordedFormat(type: string): Promise<boolean> {
  let result = results.get(type)
  if (!result) {
    result = probe(type).catch(() => false)
    results.set(type, result)
  }
  return result
}

async function probe(type: string): Promise<boolean> {
  const context = new AudioContext()
  try {
    // Si el navegador dejó el audio en pausa (falta un toque de la persona), no hay nada que
    // grabar: la prueba da «no» y el grabador usa su formato.
    if (context.state !== 'running') await withTimeout(context.resume())
    const oscillator = context.createOscillator()
    const destination = context.createMediaStreamDestination()
    oscillator.connect(destination)
    oscillator.start()
    const recorder = new MediaRecorder(destination.stream, { mimeType: type })
    const chunks: Blob[] = []
    const recorded = new Promise<Blob>((resolve, reject) => {
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data)
      }
      recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType }))
      recorder.onerror = () => reject(new Error('recorder'))
    })
    recorder.start()
    setTimeout(() => {
      if (recorder.state !== 'inactive') recorder.stop()
    }, PROBE_MS)
    const blob = await withTimeout(recorded)
    oscillator.stop()
    if (blob.size === 0) return false
    const decoded = await withTimeout(context.decodeAudioData(await blob.arrayBuffer()))
    return decoded.length > 0
  } finally {
    void context.close()
  }
}

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), PROBE_TIMEOUT_MS)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}
