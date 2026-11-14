/**
 * El texto de una evolución en la historia del sujeto. Una evolución registrada por error en
 * este sujeto (D24) no se borra ni se tapa: queda con su marca, y el texto original plegado.
 * A quien no le corresponde leerlo, el servidor no se lo manda: acá solo se dice.
 */
export interface EvolutionVoidInfo {
  reason: string
  declaredAt: string
}

export function voidedLabel(voided: EvolutionVoidInfo): string {
  return `Registrada por error en este sujeto · ${new Date(voided.declaredAt).toLocaleDateString('es-AR')}`
}

export const VOIDED_TEXT_WITHHELD = 'El texto original no se muestra acá: lo ven quien la escribió y quien coordina el estudio.'

export function EvolutionBody({ content, voided }: { content: string | null; voided?: EvolutionVoidInfo | null }) {
  if (!voided) return <p className="whitespace-pre-wrap text-sm leading-relaxed text-alphi-navy">{content}</p>
  return (
    <div className="space-y-2">
      <p role="status" className="text-xs font-semibold text-alphi-amber">
        {voidedLabel(voided)}
      </p>
      {content === null ? (
        <p className="text-xs text-alphi-muted">{VOIDED_TEXT_WITHHELD}</p>
      ) : (
        <details className="text-sm text-alphi-muted">
          <summary className="cursor-pointer text-xs font-semibold text-alphi-navy">Ver el texto original</summary>
          <p className="mt-2 whitespace-pre-wrap leading-relaxed">{content}</p>
        </details>
      )}
    </div>
  )
}
