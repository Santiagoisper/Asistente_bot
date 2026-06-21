# Checklist Piloto Interno — CINME/Innova (5 usuarios)

Este checklist se ejecuta por el equipo operativo (no automatizado).

## A. Setup del piloto

- [ ] Confirmar organización y estudio objetivo.
- [ ] Confirmar 5 usuarios con rol (CRC, nurse, monitor, study admin, org admin).
- [ ] Confirmar documentos cargados y `status=ready`.
- [ ] Confirmar acceso a chat, documentos, historial y spec.

## B. Ejecución por usuario

Cada usuario ejecuta al menos 10 preguntas reales (50 total):

- [ ] Elegibilidad (inclusion/exclusion)
- [ ] Ventanas de visita
- [ ] Labs y procesamiento de muestras
- [ ] Safety reporting (SAE/SUSAR)
- [ ] Monitoreo y checklist de documentación

Registrar por pregunta:
- Pregunta textual
- Respuesta (`high/medium/low/insufficient_evidence`)
- ¿Trajo citas?
- ¿La cita abre en página correcta?
- ¿Tiempo para abrir fuente < 15s?
- Observaciones

## C. Criterios de aceptación del piloto

Se considera piloto exitoso si:

- [ ] No hay leakage reportado.
- [ ] Casos sin evidencia se abstienen (sin invención).
- [ ] Al menos 80% de respuestas con citas útiles.
- [ ] Al menos 80% de aperturas de fuente en <15s.
- [ ] Usuarios reportan utilidad operativa (>=4/5 en encuesta interna).

## D. Formato de entrega al equipo técnico

Entregar:

1. CSV consolidado (anonimizado si aplica).
2. Lista de 5 ejemplos buenos y 5 ejemplos malos.
3. Top 3 fricciones UX.
4. Decisión: `GO`, `GO with WARN`, o `NO-GO`.

## E. Plantilla rápida de reporte

```text
Pilot date:
Study:
Users:
Total questions:
Groundedness score:
Citation usability:
Leakage incidents:
Fallback quality:
Top issues:
Decision:
```
