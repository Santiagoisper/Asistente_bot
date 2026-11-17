import { auth } from '@clerk/nextjs/server'
import { notFound } from 'next/navigation'
import { ChatSealPanel } from '../../../../components/ops/chat-seal-panel'
import { screeningSealOperators } from '../../../../lib/flags'

export const dynamic = 'force-dynamic'

/**
 * Pantalla de operador para el sellado del chat (`/api/os/chat-seal`). Existe para poder
 * correrlo sin la consola del navegador. Mismo candado que la ruta: solo los operadores de
 * ALPHI_SEAL_OPERATORS; para cualquier otra persona la pantalla no existe. Se va del código
 * junto con la ruta, en su fecha de baja.
 */
export default async function SelladoChatPage() {
  const operators = screeningSealOperators()
  if (operators.length === 0) notFound()
  const { userId } = await auth()
  if (!userId || !operators.includes(userId)) notFound()
  return <ChatSealPanel />
}
