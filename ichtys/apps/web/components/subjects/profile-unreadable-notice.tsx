import { PROFILE_UNREADABLE_NOTICE } from '../../lib/subjects/profile-write-messages'

/** Aviso de la ficha cuando el perfil guardado del sujeto no se pudo leer. */
export function ProfileUnreadableNotice() {
  return (
    <div role="alert" className="rounded-lg border border-alphi-rose/30 bg-alphi-rose/10 px-4 py-3 text-sm text-alphi-navy">
      <p className="font-bold text-alphi-rose">{PROFILE_UNREADABLE_NOTICE.title}</p>
      {PROFILE_UNREADABLE_NOTICE.body.map((line) => (
        <p key={line} className="mt-1">
          {line}
        </p>
      ))}
    </div>
  )
}
