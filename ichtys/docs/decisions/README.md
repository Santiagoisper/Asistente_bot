# Architecture Decision Records (ADRs)

Registro de decisiones arquitecturales de Ichtys. Cada decisión significativa
se documenta como un ADR numerado e inmutable: `NNNN-titulo-corto.md`
(p. ej. `0001-rag-propio-sin-langchain.md`).

Un ADR no se edita una vez aceptado: si una decisión cambia, se crea un ADR
nuevo que **reemplaza** al anterior y se actualiza el estado del viejo a
"reemplazado por ADR-XXXX".

---

## Cómo crear uno

1. Copiá el template de abajo a `docs/decisions/NNNN-titulo.md` (NNNN = siguiente
   número libre, con padding: `0003`).
2. Completá las secciones. Sé concreto en *Consecuencias* (qué habilita y qué
   cierra).
3. Sumá la fila al índice.

---

## Template

```markdown
# NNNN — <Título de la decisión>

- **Estado**: propuesto | aceptado | reemplazado por ADR-XXXX | obsoleto
- **Fecha**: YYYY-MM-DD
- **Decisores**: <quiénes>
- **Tags**: <db | rag | auth | infra | ux | ...>

## Contexto

Qué problema, restricción o fuerza motiva esta decisión. Incluí enlaces a
`docs/ARCHITECTURE.md` / `docs/PRD.md` cuando aplique.

## Decisión

Qué se decidió, en una o dos oraciones claras y accionables.

## Alternativas consideradas

- **Opción A** — por qué sí / por qué no.
- **Opción B** — por qué sí / por qué no.

## Consecuencias

- **Positivas**: qué habilita / simplifica.
- **Negativas / trade-offs**: qué complica / cierra / cuesta.
- **Seguimiento**: acciones o riesgos a monitorear.
```

---

## Índice

| ADR | Título | Estado |
|-----|--------|--------|
| 0001 | (pendiente) Pipeline RAG propio sin LangChain/LlamaIndex | propuesto |
| 0002 | (pendiente) Aislamiento de tenant en la query, no en la app | propuesto |
| 005 | Field-level PHI encryption (`@ichtys/crypto`) | aceptado |

Las decisiones "no patear" del PRD (§14) —tenant isolation, cita obligatoria,
audit log y dataset de evaluación desde el día 1— son la base de estos ADRs.
