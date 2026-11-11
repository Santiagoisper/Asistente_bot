# @ichtys/integrations

Lado OS del contrato de integración del Clinical Research OS con sus sistemas
satélite (Queries, Viáticos, Operación). Solo lectura.

- `signOsToken` / `verifyOsToken` — JWT EdDSA (Ed25519) de vida corta. El OS
  firma con la clave privada; cada satélite verifica con la pública.
- `moduleSummarySchema` — forma de `GET {baseUrl}/api/os/summary`.
- `fetchModuleSummary` — cliente con tiempo límite, tope de tamaño, validación
  y caché de respuestas correctas.

## Variables de entorno (solo en el OS)

| Variable | Uso |
|---|---|
| `OS_QUERIES_URL`, `OS_VIATICOS_URL`, `OS_OPERACION_URL` | URL base de cada satélite. Sin valor: `not_configured`. Debe ser `https://` salvo `localhost`/`127.0.0.1`. |
| `OS_SIGNING_PRIVATE_KEY` | Clave privada Ed25519 en PEM (PKCS#8). Admite `\n` escapados. |

Generar el par de claves:

```bash
openssl genpkey -algorithm ed25519 -out os-signing.pem
openssl pkey -in os-signing.pem -pubout -out os-signing.pub.pem
```

La pública se entrega a cada satélite. La privada no sale del OS.

## Reglas del contrato

- El satélite responde `ModuleSummary` y nada más: sin nombres ni documentos
  de pacientes; se admiten códigos de sujeto y de protocolo.
- Montos en USD (`unit: "usd"`).
- Reclamos del token: `iss = "clinical-research-os"`, `aud` = módulo,
  `sub` = usuario de Clerk, `org` = organización, `exp - iat ≤ 60 s`.
