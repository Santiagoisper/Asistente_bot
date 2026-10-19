# ALPHI — Reporte Reviewer (Asistente_bot, tomado por Foreman)

## Revisión del plan ALPHI 2.0 en ichtys

### Estructura actual
- Monorepo ichtys con apps/web (Next.js 16, Clerk, Tailwind).
- Navegación: Estudios, Librería, Ajustes. Agregado: Calidad.
- Chat RAG funcional por estudio.

### Hallazgos
- Falta: Mi jornada, Protocolo inteligente, Visit Assistant, Consulta global.
- Falta: Nav links para las nuevas rutas.
- El layout (app) es el lugar para agregar navegación.

### Recomendación
- Crear rutas: /jornada, /protocolo, /visita, /consulta, /calidad.
- Agregar nav links correspondientes.
- Portar lib/visit-window.ts y lib/quality.ts desde Asistente-CRF.
EOF