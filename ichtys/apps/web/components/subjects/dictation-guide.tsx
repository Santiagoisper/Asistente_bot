/**
 * Guía para dictar: lo que el médico lee mientras habla
 * (docs/decisions/consulta-dictada.md, D13). Todo el contenido sale de
 * `@ichtys/clinical`, de las mismas constantes con las que se arma el borrador:
 * acá no se escribe ninguna frase que el sistema no reconozca.
 *
 * Compacta a propósito: tiene que entrar en la pantalla al lado del cuadro de la
 * evolución. En pantalla ancha queda fija mientras se recorre el formulario.
 */
import { DICTATION_GLOSSARY, DICTATION_GUIDE_RULES, DICTATION_GUIDE_STEPS } from '@ichtys/clinical'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1">
      <h4 className="text-[11px] font-bold uppercase tracking-wide text-alphi-muted">{title}</h4>
      {children}
    </section>
  )
}

const said = 'font-semibold text-alphi-navy'

export function DictationGuide() {
  const { correction, alwaysCheck, nothingToReport } = DICTATION_GUIDE_RULES
  return (
    <aside
      className="rounded-lg border border-alphi-border bg-white text-[13px] leading-snug lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto"
      aria-label="Guía para dictar"
    >
      <details open className="group">
        <summary className="cursor-pointer select-none px-3 py-2 text-sm font-bold text-alphi-navy">
          Guía para dictar
          <span className="ml-2 text-xs font-normal text-alphi-muted group-open:hidden">mostrar</span>
        </summary>

        <div className="space-y-3 border-t border-alphi-border px-3 py-3">
          <Section title="Decí el apartado y después el dato">
            <ol className="space-y-1">
              {DICTATION_GUIDE_STEPS.map((step, index) => (
                <li key={step.title} className="grid grid-cols-[1.25rem_minmax(0,1fr)]" title={step.hint}>
                  <span className="text-xs tabular-nums text-alphi-muted">{index + 1}.</span>
                  <span>
                    <span className={said}>{step.say ? `«${step.say}»` : 'Para empezar'}</span>{' '}
                    <span className="italic text-alphi-muted">{step.example}</span>
                  </span>
                </li>
              ))}
            </ol>
          </Section>

          <Section title="Para cambiar de apartado">
            <p>
              Pausa corta y el nombre del que sigue. Si no hay nada que contar: <span className={said}>«{nothingToReport}»</span>.
            </p>
          </Section>

          <Section title="Si te equivocás">
            <p>
              <span className={said}>«{correction.words[0]}»</span> y el dato bueno. <span className="italic text-alphi-muted">{correction.example}</span>
            </p>
            <p className="text-xs text-alphi-muted">También: {correction.words.slice(1).map((word) => `«${word}»`).join(', ')}.</p>
          </Section>

          <Section title="Cómo decir los datos">
            <dl className="space-y-0.5">
              {DICTATION_GLOSSARY.map((entry) => (
                <div key={entry.what}>
                  <dt className={`inline ${said}`}>{entry.what}: </dt>
                  <dd className="inline text-alphi-muted">{entry.say}</dd>
                </div>
              ))}
            </dl>
          </Section>

          <Section title="Revisá siempre">
            <p>Lo que más se transcribe mal: {alwaysCheck.join(', ')}.</p>
          </Section>

          <p className="border-t border-alphi-border pt-2 text-xs text-alphi-muted">
            También podés dictar de corrido, sin nombrar apartados: el texto respeta lo que dijiste.
          </p>
        </div>
      </details>
    </aside>
  )
}
