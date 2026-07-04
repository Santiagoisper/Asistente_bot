# Plan B — grabación demo (video)

Si la conexión falla en la presentación a inversores, usar video pre-grabado.

## Qué grabar (5–8 min)

1. Login → estudio **MOCK-METABOLIC-T2D-v1**
2. Preguntas **SM-001, SM-002, SM-003** (ver [`demo-script.md`](demo-script.md))
3. Mostrar **cita clickeable** y sección del protocolo
4. Pregunta **SM-011** (warfarina) → respuesta `insufficient_evidence`

## Herramienta

- OBS, Loom, o grabador nativo Windows (Win+G)
- Resolución 1080p, cursor visible, sin PHI en pantalla

## Dónde guardar

Colocar el archivo aquí (gitignored si es pesado):

```
docs/evals/demo-recording/alphi-demo-T2D-mock.mp4
```

Agregar a `.gitignore` si no debe subirse al repo:

```
docs/evals/demo-recording/*.mp4
```

## Checklist pre-grabación

- [ ] `pnpm demo:setup` OK
- [ ] Ventana limpia (sin tabs personales)
- [ ] Org demo activa
- [ ] Audio claro si hay narración
