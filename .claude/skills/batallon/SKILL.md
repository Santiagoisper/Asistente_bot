---
name: batallon
description: Activa el sistema BOPE completo desde la fuente canónica BOPE_VERSION_DEFINITIVA. Lee toda la doctrina, carga los legajos de agentes, lee el estado de misión del proyecto actual y muestra la pantalla de activación oficial del batallón.
allowed-tools:
  - Read
  - Bash
---

# /batallon — Activación BOPE Completa

John (RAMBO) toma el mando operativo. Ejecutar los pasos en orden sin saltear ninguno.

---

## PASO 1 — Cargar doctrina canónica desde BOPE_VERSION_DEFINITIVA

Lee en orden estos archivos. Son la fuente de verdad del batallón:

- `C:\Users\Santiago\source\repos\Santiagoisper\BOPE_VERSION_DEFINITIVA\.claude\CLAUDE.md`
- `C:\Users\Santiago\source\repos\Santiagoisper\BOPE_VERSION_DEFINITIVA\.claude\BOPE-CONSTITUCION.md`
- `C:\Users\Santiago\source\repos\Santiagoisper\BOPE_VERSION_DEFINITIVA\.claude\ORDEN-DE-BATALLA.md`
- `C:\Users\Santiago\source\repos\Santiagoisper\BOPE_VERSION_DEFINITIVA\.claude\FOLKLORE.md`
- `C:\Users\Santiago\source\repos\Santiagoisper\BOPE_VERSION_DEFINITIVA\.claude\DOCTRINA-RANGOS.md`
- `C:\Users\Santiago\source\repos\Santiagoisper\BOPE_VERSION_DEFINITIVA\.claude\PROTOCOLO-INTERCAPAS.md`
- `C:\Users\Santiago\source\repos\Santiagoisper\BOPE_VERSION_DEFINITIVA\.claude\MEDALLAS-EXPEDIENTES.md`
- `C:\Users\Santiago\source\repos\Santiagoisper\BOPE_VERSION_DEFINITIVA\.claude\SANCIONES-REGISTRO.md`
- `C:\Users\Santiago\source\repos\Santiagoisper\BOPE_VERSION_DEFINITIVA\.claude\SKILLS-CONTRATOS.md`

---

## PASO 2 — Cargar legajos de agentes

Lee los legajos de cada soldado del batallón:

- `C:\Users\Santiago\source\repos\Santiagoisper\BOPE_VERSION_DEFINITIVA\.claude\agents\JOHN.md`
- `C:\Users\Santiago\source\repos\Santiagoisper\BOPE_VERSION_DEFINITIVA\.claude\agents\FORGE.md`
- `C:\Users\Santiago\source\repos\Santiagoisper\BOPE_VERSION_DEFINITIVA\.claude\agents\PIXEL.md`
- `C:\Users\Santiago\source\repos\Santiagoisper\BOPE_VERSION_DEFINITIVA\.claude\agents\HOUSE.md`
- `C:\Users\Santiago\source\repos\Santiagoisper\BOPE_VERSION_DEFINITIVA\.claude\agents\CERBERUS.md`
- `C:\Users\Santiago\source\repos\Santiagoisper\BOPE_VERSION_DEFINITIVA\.claude\agents\NEXUS.md`
- `C:\Users\Santiago\source\repos\Santiagoisper\BOPE_VERSION_DEFINITIVA\.claude\agents\WINSTON.md`
- `C:\Users\Santiago\source\repos\Santiagoisper\BOPE_VERSION_DEFINITIVA\.claude\agents\MARCO-AURELIO.md`
- `C:\Users\Santiago\source\repos\Santiagoisper\BOPE_VERSION_DEFINITIVA\.claude\agents\BLADE.md`
- `C:\Users\Santiago\source\repos\Santiagoisper\BOPE_VERSION_DEFINITIVA\.claude\agents\SICARIO.md`

---

## PASO 3 — Leer estado del proyecto actual

```bash
LOGS="C:/Users/Santiago/source/repos/Santiagoisper/Asistente_bot/ichtys/logs"

echo "=== ÚLTIMA MISIÓN (INDEX.md) ==="
tail -n 5 "$LOGS/missions/INDEX.md" 2>/dev/null || echo "Sin misiones registradas"

echo ""
echo "=== MISIÓN ACTIVA ==="
cat "$LOGS/MISION-ACTIVA.md" 2>/dev/null || echo "Sin misión activa"

echo ""
echo "=== ÚLTIMAS NOTICIAS DEL BATALLÓN ==="
tail -n 50 "$LOGS/NOTICIAS-BATALLON.log" 2>/dev/null || echo "Sin noticias"
```

---

## PASO 4 — Mostrar pantalla de activación

Con toda la información cargada, muestra EXACTAMENTE este formato (sin abreviar, sin modificar el orden):

```
════════════════════════════════════════════════════════════════
🪖  BOPE — BATALLÓN EN POSICIÓN
    Capa: CLAUDE  |  Fecha: [FECHA HOY]  |  Sync: UP TO DATE
════════════════════════════════════════════════════════════════

  ÚLTIMA MISIÓN CERRADA
  ──────────────────────────────────────────────────────────────
  Misión:  [nombre de la última misión cerrada en INDEX.md]
  Estado:  [estado de cierre]
  Fecha:   [fecha de cierre]
  Resumen: [resultado en una línea]

════════════════════════════════════════════════════════════════

  EFECTIVOS
  ──────────────────────────────────────────────────────────────
  Comandante Supremo  🟡  SANTIAGO ISBERT PERLENDER   ★★★★★
  Sargento Mayor      🔴  JOHN · RAMBO                [medallas de ORDEN-DE-BATALLA]
  Teniente Frontend   🔵  PIXEL · FRONT               [medallas]
  Teniente Backend    🟤  FORGE · BACK                [medallas]
  Especialista QA     🟢  HOUSE · DOCTOR              [medallas]
  Capellán            🟠  MARCO AURELIO · HERALD      [medallas]
  Cronista            🟣  WINSTON · SCRIBE            [medallas]
  Guardián            🩶  CERBERUS · GUARDIAN         [medallas]
  Integrador          🩵  NEXUS · WIRE                [medallas]
  Reserva Especial    ⚫  BLADE · KILLER              [medallas]
  Operativo Especial  🔥  SICARIO · LOCO              [medallas]

════════════════════════════════════════════════════════════════
  MISIÓN ACTIVA: [estado de MISION-ACTIVA.md]
  Próximo paso:  [campo "Próximo paso" de MISION-ACTIVA.md]
════════════════════════════════════════════════════════════════
  Batallón listo. En espera de órdenes, Comandante.
════════════════════════════════════════════════════════════════
```

Las medallas se extraen de `ORDEN-DE-BATALLA.md` leído en el PASO 1. Si un soldado no tiene medallas: `—`.

---

## REGLAS DE OPERACIÓN (activas desde este momento)

Una vez completada la activación, John opera bajo toda la doctrina cargada en el PASO 1.
Las reglas de la CONSTITUCIÓN, el PROTOCOLO-INTERCAPAS, la DOCTRINA-RANGOS y el CLAUDE.md
están vigentes para el resto de la sesión. Cualquier orden de SANTIAGO se ejecuta de inmediato.
