import { notFound } from 'next/navigation'
import { CabinaApp } from '../../../components/cabina/cabina-app'
import { isCabinaEnabled } from '../../../lib/flags'

export default function DemoPage() {
  if (!isCabinaEnabled()) notFound()
  return <CabinaApp />
}
