-- Seed sintético mínimo para el recorrido E2E de Ichtys.
-- Requiere esquema aplicado hasta packages/db/migrations/0015.
-- No ejecutar contra Producción ni contra el Preview actual: Foreman confirmó
-- que su Neon comparte la base productiva. Usar solo una DB desechable aislada.
--
-- Uso desde psql (sin imprimir credenciales):
--   psql "$E2E_DATABASE_URL" \
--     -v target_confirmation=ISOLATED_PREVIEW \
--     -v clerk_org_id="$CLERK_TEST_ORG_ID" \
--     -f ichtys/scripts/e2e/seed-os-e2e-sintetica.sql
-- clerk_org_id debe ser el ID de la organización ficticia creada en Clerk de
-- prueba. El marcador no se inventa aquí porque el ID real lo emite Clerk.
--
-- Solo usa columnas creadas hasta 0015 en organizations, sites, studies y
-- subjects. No inserta datos clínicos ni nombres, documentos de identidad o
-- fechas de nacimiento.

\set ON_ERROR_STOP on

\if :{?target_confirmation}
\else
  \echo 'ERROR: falta -v target_confirmation=ISOLATED_PREVIEW; no se sembró nada.'
  \quit 3
\endif

SELECT :'target_confirmation' = 'ISOLATED_PREVIEW' AS target_is_isolated \gset
\if :target_is_isolated
\else
  \echo 'ERROR: destino no confirmado como aislado; no se sembró nada.'
  \quit 3
\endif

\if :{?clerk_org_id}
\else
  \echo 'ERROR: falta -v clerk_org_id=<ID de org Clerk de prueba>; no se sembró nada.'
  \quit 3
\endif

SELECT length(btrim(:'clerk_org_id')) > 0 AS clerk_org_id_present \gset
\if :clerk_org_id_present
\else
  \echo 'ERROR: clerk_org_id está vacío; no se sembró nada.'
  \quit 3
\endif

SELECT (
  NOT EXISTS (
    SELECT 1 FROM organizations
    WHERE clerk_org_id = :'clerk_org_id'
       OR id = 'e2000000-0000-4000-8000-000000000001'::uuid
  )
  OR EXISTS (
    SELECT 1 FROM organizations
    WHERE clerk_org_id = :'clerk_org_id'
      AND id = 'e2000000-0000-4000-8000-000000000001'::uuid
      AND name = 'OS-E2E-SINTETICA'
  )
) AS organization_id_is_safe \gset
\if :organization_id_is_safe
\else
  \echo 'ERROR: clerk_org_id o UUID ya pertenece a otra organización; no se sembró nada.'
  \quit 3
\endif

BEGIN;

WITH seeded_org AS (
  INSERT INTO organizations (id, name, clerk_org_id)
  VALUES (
    'e2000000-0000-4000-8000-000000000001',
    'OS-E2E-SINTETICA',
    :'clerk_org_id'
  )
  ON CONFLICT (id) DO UPDATE
    SET name = EXCLUDED.name,
        clerk_org_id = EXCLUDED.clerk_org_id,
        updated_at = now()
  RETURNING id
)
INSERT INTO sites (id, organization_id, name)
SELECT seeded_org.id, site.id, site.name
FROM seeded_org
CROSS JOIN (VALUES
  ('e2000000-0000-4000-8000-000000000002'::uuid, 'Centro Ficticio Aurora E2E'),
  ('e2000000-0000-4000-8000-000000000003'::uuid, 'Centro Ficticio Boreal E2E')
) AS site(id, name)
ON CONFLICT (id) DO UPDATE
  SET organization_id = EXCLUDED.organization_id,
      name = EXCLUDED.name;

WITH seeded_org AS (
  SELECT id FROM organizations WHERE clerk_org_id = :'clerk_org_id'
)
INSERT INTO studies (id, organization_id, site_id, name, protocol_number, status)
SELECT study.id, seeded_org.id, study.site_id, study.name, study.protocol_number, 'active'
FROM seeded_org
CROSS JOIN (VALUES
  (
    'e2000000-0000-4000-8000-000000000004'::uuid,
    'e2000000-0000-4000-8000-000000000002'::uuid,
    'E2E Estudio Alfa',
    'E2E-PROT-ALFA-001'
  ),
  (
    'e2000000-0000-4000-8000-000000000005'::uuid,
    'e2000000-0000-4000-8000-000000000003'::uuid,
    'E2E Estudio Beta',
    'E2E-PROT-BETA-002'
  )
) AS study(id, site_id, name, protocol_number)
ON CONFLICT (id) DO UPDATE
  SET organization_id = EXCLUDED.organization_id,
      site_id = EXCLUDED.site_id,
      name = EXCLUDED.name,
      protocol_number = EXCLUDED.protocol_number,
      status = EXCLUDED.status,
      updated_at = now();

WITH seeded_org AS (
  SELECT id FROM organizations WHERE clerk_org_id = :'clerk_org_id'
)
INSERT INTO subjects (id, organization_id, study_id, subject_code, status)
SELECT subject.id, seeded_org.id, subject.study_id, subject.subject_code, 'screening'
FROM seeded_org
CROSS JOIN (VALUES
  ('e2000000-0000-4000-8000-000000000010'::uuid, 'e2000000-0000-4000-8000-000000000004'::uuid, 'E2E-ALFA-SUJ-001'),
  ('e2000000-0000-4000-8000-000000000011'::uuid, 'e2000000-0000-4000-8000-000000000004'::uuid, 'E2E-ALFA-SUJ-002'),
  ('e2000000-0000-4000-8000-000000000012'::uuid, 'e2000000-0000-4000-8000-000000000004'::uuid, 'E2E-ALFA-SUJ-003'),
  ('e2000000-0000-4000-8000-000000000013'::uuid, 'e2000000-0000-4000-8000-000000000005'::uuid, 'E2E-BETA-SUJ-001'),
  ('e2000000-0000-4000-8000-000000000014'::uuid, 'e2000000-0000-4000-8000-000000000005'::uuid, 'E2E-BETA-SUJ-002'),
  ('e2000000-0000-4000-8000-000000000015'::uuid, 'e2000000-0000-4000-8000-000000000005'::uuid, 'E2E-BETA-SUJ-003')
) AS subject(id, study_id, subject_code)
ON CONFLICT (id) DO UPDATE
  SET organization_id = EXCLUDED.organization_id,
      study_id = EXCLUDED.study_id,
      subject_code = EXCLUDED.subject_code,
      status = EXCLUDED.status,
      updated_at = now();

COMMIT;

-- Resumen únicamente de la org sintética sembrada.
SELECT
  o.name AS organization,
  count(DISTINCT si.id) AS fictional_centers,
  count(DISTINCT st.id) AS studies,
  count(DISTINCT su.id) AS subjects
FROM organizations AS o
LEFT JOIN sites AS si ON si.organization_id = o.id
LEFT JOIN studies AS st ON st.organization_id = o.id
LEFT JOIN subjects AS su ON su.organization_id = o.id
WHERE o.clerk_org_id = :'clerk_org_id'
GROUP BY o.id, o.name;
