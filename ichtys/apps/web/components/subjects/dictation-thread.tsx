import { DICTATION_GUIDE_STEPS } from '@ichtys/clinical'

/**
 * El hilo de qué decir, junto al botón de grabar (docs/decisions/consulta-dictada.md, D13).
 *
 * La guía completa queda al costado en una pantalla ancha y debajo del formulario en una
 * tableta: ahí no se ve mientras se dicta. Esto es su versión de un vistazo, en el lugar donde
 * se graba. Sale de las mismas constantes que la guía y el borrador: no enseña ninguna frase
 * que el sistema no reconozca. En pantalla ancha no se muestra: la guía completa ya está ahí.
 */
export function DictationThread() {
  return (
    <details open className="lg:hidden rounded-lg border border-alphi-border bg-alphi-slate text-[13px] leading-snug text-alphi-navy">
      <summary className="cursor-pointer select-none px-3 py-2 text-sm font-bold">Qué decir, en orden</summary>
      <div className="border-t border-alphi-border px-3 py-2">
        <p className="mb-2 text-xs text-alphi-muted">Decí el apartado y después el dato. Lo que no nombres queda marcado como no mencionado, a la vista.</p>
        <ol className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
          {DICTATION_GUIDE_STEPS.map((step, index) => (
            <li key={step.title} className="grid grid-cols-[1.5rem_minmax(0,1fr)]">
              <span className="text-xs tabular-nums text-alphi-muted">{index + 1}.</span>
              <span>
                {/* El primer paso no tiene nombre: se empieza diciendo qué visita es y la edad. */}
                {step.say ? <span className="font-semibold">«{step.say}»</span> : <span className="italic">{step.example}</span>}
                <span className="block text-xs text-alphi-muted">{step.hint}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>
    </details>
  )
}
