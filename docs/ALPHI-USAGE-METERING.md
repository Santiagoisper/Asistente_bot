# ALPHI — Consumo de tokens y cuota mensual (modelo híbrido)

Estado: **etapa 1 implementada en código (sin aplicar a producción)**. Etapas 2 y 3 pendientes.

## Modelo de negocio (decisión: opción C, híbrido)

- El cliente paga una **cuota mensual** que incluye un **cupo de tokens** del modelo de la plataforma.
- El cliente ve cuánto lleva consumido y cuánto le queda.
- Si agota el cupo, puede **cargar su propia clave** de modelo (ya existe en Ajustes) y seguir usando
  ALPHI; ese consumo no descuenta del cupo.
- Sin cupo definido (organización sin plan) no se limita nada.

## Qué se mide

Una fila en `usage_events` por llamada a un modelo (LLM o embeddings): organización, estudio, usuario,
tipo de operación, proveedor, modelo, tokens de entrada y salida, y **quién pagó** (`platform` u `org`).

**Nunca** se guarda contenido (preguntas, respuestas, texto de documentos): solo conteos. La tabla es
append-only y sin claves foráneas, como `audit_logs`, para conservar el historial de facturación.

Tipos (`usage_events.kind`): `chat_answer`, `chat_eval`, `chat_title`, `spec_extraction`,
`clinical_extraction`, `embedding_document`, `embedding_query`.

El cupo del mes (calendario UTC) = suma de input+output de los eventos con `key_source = 'platform'`.

## Etapas (un PR por capa, según `CLAUDE.md`)

| Etapa | Contenido | Estado |
|---|---|---|
| 1 | Tabla `usage_events`, columnas `organizations.plan_name` / `monthly_token_quota`, migración `0009`, módulo `packages/db/usage.ts` (registrar, resumir, estado del cupo, asignar plan) y tests | Hecha, **migración sin aplicar** |
| 2 | Enganchar cada llamada a un modelo para registrar el consumo (chat ×3, título, spec, perfil clínico, embeddings de documentos y de consultas) | Pendiente |
| 3 | Pantalla "Consumo" para el cliente (barra del cupo, desglose por tipo, aviso al 80 %) y tope cuando el cupo se agota (mensaje claro: cargar clave propia o ampliar plan) | Pendiente |
| 4 | Cobro automático de la cuota (Stripe u otro) y precios por modelo | Pendiente; requiere decisiones comerciales |

## Cómo aplicar la migración (acción manual, requiere autorización)

La migración `0009_usage_metering.sql` solo **agrega** objetos nuevos y es idempotente
(`IF NOT EXISTS`). No modifica ni borra datos. Las migraciones **no** se aplican en el deploy
(ver `ichtys/docs/OPERATIONS.md` §9, incidente del 2026-06-28):

1. Verificar en una branch de Neon (no en producción directamente).
2. Aplicar en producción **antes** de desplegar código que use las tablas nuevas.
3. Confirmar: `SELECT column_name FROM information_schema.columns WHERE table_name = 'usage_events';`

## Decisiones pendientes (no técnicas)

1. **Cupo por plan:** cuántos tokens incluye cada nivel. Los tokens no son iguales entre
   proveedores; conviene definir el cupo en tokens de la plataforma y revisar los precios reales.
2. **Qué pasa al agotar el cupo:** hoy el diseño propone bloquear solo el uso con clave de la
   plataforma, con un mensaje claro. Alternativa: permitir un sobreconsumo facturado aparte.
3. **Aviso al cliente:** al 80 % (valor por defecto, `QUOTA_WARNING_RATIO`).
4. **Cobro:** manual (factura mensual) o automático.

## Privacidad

- No se guarda texto del usuario ni de documentos en `usage_events`.
- `recordUsage()` nunca lanza ni registra detalles del error de la base: la medición no puede
  degradar el producto ni filtrar datos.
- Toda consulta del módulo filtra por `organization_id`.
