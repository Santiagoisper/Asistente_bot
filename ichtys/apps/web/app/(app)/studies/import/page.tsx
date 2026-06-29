import Link from 'next/link'
import { BulkImport } from '../../../../components/documents/bulk-import'

export default function BulkImportPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <p className="alphi-label mb-1">Importación masiva</p>
        <h1 className="text-2xl font-bold text-alphi-navy">Subir varios protocolos</h1>
        <p className="mt-1 text-sm text-alphi-muted">
          Subí varios PDFs de protocolo a la vez. Creamos un estudio por cada uno y extraemos
          automáticamente su contenido (chunks indexados + spec estructurado).
        </p>
      </div>

      <BulkImport />

      <div className="flex items-center gap-3 text-sm">
        <Link href="/studies" className="alphi-btn-ghost">
          &larr; Volver a estudios
        </Link>
        <Link href="/library" className="alphi-btn-ghost">
          Ver librería de protocolos
        </Link>
      </div>
    </div>
  )
}
