import { VOIDED_ORIGIN_UNKNOWN, voidedOriginLines, voidedOriginTitle, type VoidedOriginNotice } from '../../lib/subjects/voided-origin'

/**
 * El aviso de la ficha cuando el perfil incluye datos que entraron desde una evolución anulada
 * (D24, punto 2). No se puede cerrar: se va cuando esos datos ya no están en el perfil.
 * Alphi no los saca solo.
 */
export function VoidedOriginNoticeCard({ notice, checkFailed }: { notice: VoidedOriginNotice | null; checkFailed: boolean }) {
  if (!notice) {
    return checkFailed ? <p className="mb-3 text-xs text-alphi-muted">{VOIDED_ORIGIN_UNKNOWN}</p> : null
  }
  return (
    <div role="status" className="mb-3 rounded-lg border border-alphi-amber/30 bg-alphi-amber/10 px-4 py-3">
      <p className="text-sm font-semibold text-alphi-navy">{voidedOriginTitle(notice)}</p>
      <ul className="mt-2 space-y-1 text-xs text-alphi-navy/80">
        {voidedOriginLines(notice).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  )
}
