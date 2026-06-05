# Architecture Decision Records (ADRs)

Registro de decisiones arquitecturales de Ichtys. Cada decisión significativa
se documenta como un ADR numerado: `NNNN-titulo-corto.md`.

## Formato

```
# NNNN — Título de la decisión

- **Estado**: propuesto | aceptado | reemplazado por ADR-XXXX
- **Fecha**: YYYY-MM-DD
- **Contexto**: qué problema/restricción motiva la decisión
- **Decisión**: qué decidimos
- **Consecuencias**: trade-offs, qué habilita, qué cierra
```

## Índice

| ADR | Título | Estado |
|-----|--------|--------|
| 0001 | (pendiente) Pipeline RAG propio sin LangChain/LlamaIndex | propuesto |
| 0002 | (pendiente) Aislamiento de tenant en la query, no en la app | propuesto |

Las decisiones "no patear" del PRD (§14) —tenant isolation, cita obligatoria,
audit log y dataset de evaluación desde el día 1— son la base de estos ADRs.
