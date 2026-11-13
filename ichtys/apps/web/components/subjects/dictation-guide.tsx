/**
 * Guía para dictar: lo que el médico lee mientras habla
 * (docs/decisions/consulta-dictada.md, D13). Todo el contenido sale de
 * `@ichtys/clinical`, de las mismas constantes con las que se arma el borrador:
 * acá no se escribe ninguna frase que el sistema no reconozca.
 *
 * Compacta a propósito: tiene que entrar en la pantalla al lado del cuadro de la
 * evolución. En pantalla ancha queda fija mientras se recorre el formulario.
 */
import { DICTATION_GLOSSARY, DICTATION_GUIDE_RULES, DICTATION_GUIDE_STEPS, type StudyPrompt } from '@ichtys/clinical'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1">
      <h4 className="text-[11px] font-bold uppercase tracking-wide text-alphi-muted">{title}</h4>
      {children}
    </section>
  )
}

const said = 'font-semibold text-alphi-navy'

const quoted = (phrases: readonly string[]) => phrases.map((phrase) => `«${phrase}»`).join(' ')

/**
 * Lo que este estudio pide además, para este sujeto (D18). Sale de los criterios que
 * quedaron a revisar por un dato que falta. Para una exclusión muestra las dos frases, la
 * que la despeja y la que la activa: la guía no empuja a decir que no.
 */
function StudyPrompts({ prompts, unapproved }: { prompts: readonly StudyPrompt[]; unapproved: boolean }) {
  return (
    <Section title="Para este estudio, decí también">
      <ul className="space-y-1.5">
        {prompts.map((prompt) => (
          <li key={prompt.id}>
            <span className={said}>{prompt.ask}</span>{' '}
            <span className="text-xs text-alphi-muted">
              (criterio{prompt.criteria.length > 1 ? 's' : ''} {prompt.criteria.join(', ')})
            </span>
            {prompt.sayIfPresent ? (
              <span className="block">
                <span className="text-xs text-alphi-muted">Si no: </span>
                <span className="italic text-alphi-muted">{quoted(prompt.say)}</span>
                <span className="text-xs text-alphi-muted"> · Si sí: </span>
                <span className="italic text-alphi-muted">{prompt.sayIfPresent.map((phrase) => `«${phrase}»`).join(' o ')}</span>
              </span>
            ) : prompt.say.length > 0 ? (
              <span className="block italic text-alphi-muted">{quoted(prompt.say)}</span>
            ) : null}
            {prompt.note ? <span className="block text-xs text-alphi-muted">{prompt.note}</span> : null}
          </li>
        ))}
      </ul>
      {unapproved ? <p className="text-xs text-alphi-amber">Sale de criterios del protocolo que nadie aprobó todavía.</p> : null}
    </Section>
  )
}

interface DictationGuideProps {
  /** Datos que le faltan a este sujeto para los criterios del estudio. Vacío: no se muestra nada. */
  studyPrompts?: readonly StudyPrompt[]
  /** El protocolo extraído todavía no está aprobado: la guía lo dice. */
  unapprovedProtocol?: boolean
}

export function DictationGuide({ studyPrompts = [], unapprovedProtocol = false }: DictationGuideProps) {
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
          {studyPrompts.length > 0 ? <StudyPrompts prompts={studyPrompts} unapproved={unapprovedProtocol} /> : null}

          <Section title="Decí el apartado y después el dato">
            <ol className="space-y-1">
              {DICTATION_GUIDE_STEPS.map((step, index) => (
                <li key={step.title} className="grid grid-cols-[1.25rem_minmax(0,1fr)]" title={step.hint}>
                  <span className="text-xs tabular-nums text-alphi-muted">{index + 1}.</span>
                  <span>
                    {/* El primer paso no lleva título: cualquier palabra escrita acá se lee en voz alta (pasó). */}
                    {step.say ? <span className={said}>«{step.say}» </span> : null}
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
