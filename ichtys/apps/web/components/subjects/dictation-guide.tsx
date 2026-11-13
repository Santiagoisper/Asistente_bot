/**
 * Guía para dictar: lo que el médico lee mientras habla
 * (docs/decisions/consulta-dictada.md, D13). Todo el contenido sale de
 * `@ichtys/clinical`, de las mismas constantes con las que se arma el borrador:
 * acá no se escribe ninguna frase que el sistema no reconozca.
 */
import { DICTATION_GLOSSARY, DICTATION_GUIDE_RULES, DICTATION_GUIDE_STEPS } from '@ichtys/clinical'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h4 className="text-xs font-bold uppercase tracking-wide text-alphi-muted">{title}</h4>
      {children}
    </section>
  )
}

const said = 'rounded bg-slate-100 px-1.5 py-0.5 font-semibold text-alphi-ink'

export function DictationGuide() {
  const { correction, alwaysCheck, nothingToReport } = DICTATION_GUIDE_RULES
  return (
    <aside className="rounded-lg border border-alphi-border bg-slate-50 text-sm" aria-label="Guía para dictar">
      <details open className="group">
        <summary className="cursor-pointer select-none px-4 py-3 text-sm font-bold text-alphi-ink">
          Guía para dictar
          <span className="ml-2 text-xs font-normal text-alphi-muted group-open:hidden">mostrar</span>
        </summary>

        <div className="space-y-4 border-t border-alphi-border px-4 py-3">
          <Section title="1 · Decí el apartado y después lo que corresponde">
            <ol className="space-y-2">
              {DICTATION_GUIDE_STEPS.map((step, index) => (
                <li key={step.title} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-1">
                  <span className="text-xs font-semibold tabular-nums text-alphi-muted">{index + 1}.</span>
                  <div>
                    {step.say ? <span className={said}>«{step.say}»</span> : <span className="font-semibold text-alphi-ink">Para empezar</span>}
                    <span className="text-alphi-muted"> — {step.hint}</span>
                    <p className="mt-0.5 text-xs italic text-alphi-muted">{step.example}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Section>

          <Section title="2 · Para cambiar de apartado">
            <p>
              Hacé una pausa y decí el nombre del que sigue. Si en uno no hay nada que contar, nombralo y decí{' '}
              <span className={said}>«{nothingToReport}»</span>: así no figura como faltante.
            </p>
          </Section>

          <Section title="3 · Si te equivocás">
            <p>
              Decí <span className={said}>«{correction.words[0]}»</span> y el dato bueno. Queda el segundo y el borrador te muestra los dos.
            </p>
            <p className="text-xs italic text-alphi-muted">{correction.example}</p>
            <p className="text-xs text-alphi-muted">También sirven: {correction.words.slice(1).map((word) => `«${word}»`).join(', ')}.</p>
          </Section>

          <Section title="4 · Cómo decir los datos">
            <dl className="space-y-1">
              {DICTATION_GLOSSARY.map((entry) => (
                <div key={entry.what} className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-2">
                  <dt className="font-semibold text-alphi-ink">{entry.what}</dt>
                  <dd className="text-alphi-muted">{entry.say}</dd>
                </div>
              ))}
            </dl>
          </Section>

          <Section title="5 · Revisá siempre en el borrador">
            <p>
              Lo que más se transcribe mal: {alwaysCheck.join(', ')}. Los números suelen salir bien; igual compará el borrador con lo que dijiste.
            </p>
          </Section>

          <p className="border-t border-alphi-border pt-3 text-xs text-alphi-muted">
            También podés dictar de corrido, sin nombrar apartados: el borrador respeta tu texto y te lista los apartados que no escuchó.
          </p>
        </div>
      </details>
    </aside>
  )
}
