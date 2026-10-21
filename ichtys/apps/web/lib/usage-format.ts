/**
 * usage-format.ts — formato de importes del consumo.
 *
 * Archivo sin dependencias de servidor a propósito: lo importa un componente de cliente y no
 * debe arrastrar código de base de datos al navegador.
 */
export function formatUsd(value: number): string {
  return `US$ ${value.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
