# ALPHI — Reporte Architect (Asistente_bot, tomado por Foreman)

## Fuente de verdad de la paleta (H2)

Decisión: `tailwind.config.ts` es la fuente de verdad. `globals.css` variables deben espejar los mismos valores. Ambos ya están alineados:
- navy #192337
- teal (violeta) #6855B6
- slate #F7F8FC
- border #E5E8F0
- muted #667085
- Softs: violet #F1EDFA, green #E9F7F0, blue #EAF3FC, amber #FFF4E2, rose #FCEEF1

Los overrides de Clerk en globals.css deben usar los mismos valores (verificar).

## Stamp canónico de versión del motor (H6)

Decisión: `visit-window-motor v0.1.0 (TS mirror)` (del prototipo canónico de Asistente-CRF). El port en ichtys usa '1.0.0' — actualizar a 'v0.1.0 (TS mirror)' para consistencia entre repos.

## Arquitectura de navegación ALPHI 2.0

Navegación principal: Mi jornada | Estudios | Biblioteca | Asistente
Dentro de estudio: Resumen | Visitas | Protocolo | Documentos | Consultar
Módulos técnicos en navegación secundaria.

## Reutilización

- Reutilizar study_specs, spec-extractor, spec-review existentes.
- No crear ASIM duplicado; extender el modelo existente.
- Rust: PoC aislado (motor de ventanas), comparar con TS.
EOF