# Cabina de demostración

Los tipos de `types.ts` son el contrato de la hoja de visita. La demo los llena con datos ficticios en `demo-data.ts`. No llama al extractor, no lee la base y no usa un modelo.

Cuando el extractor nuevo exista, un adaptador tiene que convertir su salida a estos mismos tipos (`VisitDef`, `ProcedureDef`, `CellDef`, notas, reglas e inconsistencias). La interfaz no debería cambiar de forma para eso.

`schedule.ts` calcula la fecha objetivo, la ventana y el estado. `filter.ts` decide qué filas corresponden al paciente y a la visita. Una clave de condición que no se reconoce deja la fila fuera. `origen.ts` marca la cita y las dudas que bloquean aprobar o imprimir. El checklist del día se guarda solo en el navegador.
