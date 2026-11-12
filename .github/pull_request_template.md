## Qué cambia y por qué

## Marco normativo (`ichtys/docs/compliance/REGULATORY-BASELINE.md`)

- **Uso previsto (R1):** [ ] apoyo (lee, resume, ordena) · [ ] registro (crea o modifica un dato clínico, un permiso o una configuración)
- [ ] R2 · Hay una prueba automática que fija el comportamiento nuevo
- [ ] R3 · Toda escritura queda auditada en la misma transacción (o no hay escrituras)
- [ ] R4 · El acceso se decide por organización, función y estudio; el rechazo es igual al de «no existe»
- [ ] R5 · Sin datos reales en pruebas, capturas, commits ni en esta descripción
- [ ] R6 · Si interviene IA: la salida es un borrador con responsable humano; no guarda, firma, envía ni cierra sola
- [ ] R7 · Ninguna pantalla nueva presenta una acción como «firma» o «validación clínica»
- [ ] R8 · Migración (si hay) aditiva, escrita a mano y aplicable antes que el código
- [ ] R9 · No agrega un proveedor que toque datos (o lo declara abajo)
- [ ] R10 · Las marcas de tiempo salen del servidor, en UTC
- [ ] R11 · Todo lo que este PR afirma tiene su evidencia abajo; lo demás figura en «Sin verificar»

Marcar «no aplica» con una palabra donde corresponda; no dejar casillas sin responder. Si una regla todavía es un objetivo sin base (ver §4 del marco), escribir «objetivo: falta la base» en vez de marcarla.

## Evidencia

- Compuerta: typecheck · lint · test · fuga · OQ
- Entorno de prueba: qué se probó contra la base real y con qué resultado

## Sin verificar
