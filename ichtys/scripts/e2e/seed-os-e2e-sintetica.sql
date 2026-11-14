-- Seed sintético para el recorrido E2E de Ichtys; compatible con migraciones
-- 0000-0017. La 0016 solo ajusta el índice vectorial; la 0017 agrega access_mode
-- y membresías. Este seed no toca chunks ni crea membresías: requiere que ambas
-- organizaciones de prueba ya estén en access_mode='open'.
--
-- El destino futuro debe ser una rama Neon desechable de sweet-union-82704893,
-- nunca Producción ni una rama compartida. El script no crea/renombra orgs y
-- las busca por clerk_org_id. Los IDs propios derivan de cada org y de claves
-- fijas del fixture. No modifica E2E-FICT-001 / E2E-001 ni otros registros.
--
-- psql "$E2E_DATABASE_URL" \
--   -v target_confirmation=ISOLATED_PREVIEW \
--   -v clerk_org_id_a="$CLERK_TEST_ORG_ID_A" \
--   -v clerk_org_id_b="$CLERK_TEST_ORG_ID_B" \
--   -v profile_empty_encrypted="$PROFILE_EMPTY_ENCRYPTED" \
--   -f ichtys/scripts/e2e/seed-os-e2e-sintetica.sql
-- PROFILE_EMPTY_ENCRYPTED se obtiene con scripts/e2e/encrypt-empty-patient-profile.ts
-- usando PHI_ENCRYPTION_KEY del entorno de aplicación; nunca guardar/imprimir la clave.

\set ON_ERROR_STOP on

\if :{?target_confirmation}
\else
  \echo 'ERROR: falta target_confirmation=ISOLATED_PREVIEW.'
  \quit 3
\endif
SELECT :'target_confirmation' = 'ISOLATED_PREVIEW' AS target_is_isolated \gset
\if :target_is_isolated
\else
  \echo 'ERROR: destino no confirmado como aislado; no se sembró nada.'
  \quit 3
\endif

\if :{?clerk_org_id_a}
\else
  \echo 'ERROR: falta clerk_org_id_a.'
  \quit 3
\endif
\if :{?clerk_org_id_b}
\else
  \echo 'ERROR: falta clerk_org_id_b.'
  \quit 3
\endif
\if :{?profile_empty_encrypted}
\else
  \echo 'ERROR: falta profile_empty_encrypted generado por el helper de aplicación.'
  \quit 3
\endif
SELECT :'profile_empty_encrypted' ~ '^v1:[^:]+:[^:]+:[^:]+$' AS profile_cipher_valid \gset
\if :profile_cipher_valid
\else
  \echo 'ERROR: profile_empty_encrypted no tiene formato cifrado v1.'
  \quit 3
\endif

SELECT id::text AS org_a_id, name AS org_a_name, access_mode AS org_a_access_mode
FROM organizations WHERE clerk_org_id = :'clerk_org_id_a' \gset
\if :{?org_a_id}
\else
  \echo 'ERROR: clerk_org_id_a no corresponde a una organización preexistente.'
  \quit 3
\endif
SELECT id::text AS org_b_id, name AS org_b_name, access_mode AS org_b_access_mode
FROM organizations WHERE clerk_org_id = :'clerk_org_id_b' \gset
\if :{?org_b_id}
\else
  \echo 'ERROR: clerk_org_id_b no corresponde a una organización preexistente.'
  \quit 3
\endif
SELECT :'org_a_name' = 'OS-E2E-SINTETICA' AS org_a_ok,
       :'org_b_name' = 'OS-E2E-SINTETICA-2' AS org_b_ok,
       :'org_a_id' <> :'org_b_id' AS orgs_distinct,
       :'org_a_access_mode' = 'open' AS org_a_open,
       :'org_b_access_mode' = 'open' AS org_b_open \gset
\if :org_a_ok
\else
  \echo 'ERROR: clerk_org_id_a debe corresponder a OS-E2E-SINTETICA.'
  \quit 3
\endif
\if :org_b_ok
\else
  \echo 'ERROR: clerk_org_id_b debe corresponder a OS-E2E-SINTETICA-2.'
  \quit 3
\endif
\if :orgs_distinct
\else
  \echo 'ERROR: se requieren dos organizaciones distintas.'
  \quit 3
\endif
\if :org_a_open
\else
  \echo 'ERROR: OS-E2E-SINTETICA debe estar en access_mode=open; no se modificó.'
  \quit 3
\endif
\if :org_b_open
\else
  \echo 'ERROR: OS-E2E-SINTETICA-2 debe estar en access_mode=open; no se modificó.'
  \quit 3
\endif

-- La org A contiene dos estudios y dos sujetos, uno por estudio. Alfa y
-- E2E-SUJ-001 coinciden con el PDF sintético. Org B prueba aislamiento.
-- Rechazar antes de escribir si un ID o una clave natural del fixture ya está
-- ocupada por una fila diferente. Los reruns de las mismas filas son válidos.
WITH expected_sites(id, organization_id, name) AS (VALUES
  (md5(:'org_a_id' || ':e2e:site:a')::uuid, :'org_a_id'::uuid, 'Centro Ficticio Aurora E2E'),
  (md5(:'org_b_id' || ':e2e:site:b')::uuid, :'org_b_id'::uuid, 'Centro Ficticio Boreal E2E')
), expected_studies(id, organization_id, site_id, name, protocol_number) AS (VALUES
  (md5(:'org_a_id' || ':e2e:study:a1')::uuid, :'org_a_id'::uuid, md5(:'org_a_id' || ':e2e:site:a')::uuid, 'E2E Estudio Alfa', 'E2E-PROTOCOLO-001'),
  (md5(:'org_a_id' || ':e2e:study:a2')::uuid, :'org_a_id'::uuid, md5(:'org_a_id' || ':e2e:site:a')::uuid, 'E2E Estudio Gamma', 'E2E-PROT-GAMMA-002'),
  (md5(:'org_b_id' || ':e2e:study:b1')::uuid, :'org_b_id'::uuid, md5(:'org_b_id' || ':e2e:site:b')::uuid, 'E2E Estudio Beta', 'E2E-PROT-BETA-003')
), expected_subjects(id, organization_id, study_id, subject_code) AS (VALUES
  (md5(:'org_a_id' || ':e2e:subject:a001')::uuid, :'org_a_id'::uuid, md5(:'org_a_id' || ':e2e:study:a1')::uuid, 'E2E-SUJ-001'),
  (md5(:'org_a_id' || ':e2e:subject:a002')::uuid, :'org_a_id'::uuid, md5(:'org_a_id' || ':e2e:study:a2')::uuid, 'E2E-SUJ-002'),
  (md5(:'org_b_id' || ':e2e:subject:b001')::uuid, :'org_b_id'::uuid, md5(:'org_b_id' || ':e2e:study:b1')::uuid, 'E2E-BETA-SUJ-001'),
  (md5(:'org_b_id' || ':e2e:subject:b002')::uuid, :'org_b_id'::uuid, md5(:'org_b_id' || ':e2e:study:b1')::uuid, 'E2E-BETA-SUJ-002'),
  (md5(:'org_b_id' || ':e2e:subject:b003')::uuid, :'org_b_id'::uuid, md5(:'org_b_id' || ':e2e:study:b1')::uuid, 'E2E-BETA-SUJ-003')
)
SELECT NOT EXISTS (
  SELECT 1 FROM sites a JOIN expected_sites e
    ON a.id=e.id OR (a.organization_id=e.organization_id AND a.name=e.name)
  WHERE a.id<>e.id OR a.organization_id<>e.organization_id OR a.name<>e.name
) AND NOT EXISTS (
  SELECT 1 FROM studies a JOIN expected_studies e
    ON a.id=e.id OR (a.organization_id=e.organization_id AND a.protocol_number=e.protocol_number)
  WHERE a.id<>e.id OR a.organization_id<>e.organization_id OR a.site_id IS DISTINCT FROM e.site_id
     OR a.name<>e.name OR a.protocol_number IS DISTINCT FROM e.protocol_number
) AND NOT EXISTS (
  SELECT 1 FROM subjects a JOIN expected_subjects e
    ON a.id=e.id OR (a.organization_id=e.organization_id AND a.study_id=e.study_id AND a.subject_code=e.subject_code)
  WHERE a.id<>e.id OR a.organization_id<>e.organization_id OR a.study_id<>e.study_id OR a.subject_code<>e.subject_code
) AS fixture_keys_are_safe \gset
\if :fixture_keys_are_safe
\else
  \echo 'ERROR: una clave del fixture ya pertenece a otra fila; no se sembró nada.'
  \quit 3
\endif

BEGIN;
INSERT INTO sites (id, organization_id, name) VALUES
  (md5(:'org_a_id' || ':e2e:site:a')::uuid, :'org_a_id'::uuid, 'Centro Ficticio Aurora E2E'),
  (md5(:'org_b_id' || ':e2e:site:b')::uuid, :'org_b_id'::uuid, 'Centro Ficticio Boreal E2E')
ON CONFLICT (id) DO NOTHING;

INSERT INTO studies (id, organization_id, site_id, name, protocol_number, status) VALUES
  (md5(:'org_a_id' || ':e2e:study:a1')::uuid, :'org_a_id'::uuid, md5(:'org_a_id' || ':e2e:site:a')::uuid, 'E2E Estudio Alfa', 'E2E-PROTOCOLO-001', 'active'),
  (md5(:'org_a_id' || ':e2e:study:a2')::uuid, :'org_a_id'::uuid, md5(:'org_a_id' || ':e2e:site:a')::uuid, 'E2E Estudio Gamma', 'E2E-PROT-GAMMA-002', 'active'),
  (md5(:'org_b_id' || ':e2e:study:b1')::uuid, :'org_b_id'::uuid, md5(:'org_b_id' || ':e2e:site:b')::uuid, 'E2E Estudio Beta', 'E2E-PROT-BETA-003', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO subjects (id, organization_id, study_id, subject_code, status) VALUES
  (md5(:'org_a_id' || ':e2e:subject:a001')::uuid, :'org_a_id'::uuid, md5(:'org_a_id' || ':e2e:study:a1')::uuid, 'E2E-SUJ-001', 'screening'),
  (md5(:'org_a_id' || ':e2e:subject:a002')::uuid, :'org_a_id'::uuid, md5(:'org_a_id' || ':e2e:study:a2')::uuid, 'E2E-SUJ-002', 'screening'),
  (md5(:'org_b_id' || ':e2e:subject:b001')::uuid, :'org_b_id'::uuid, md5(:'org_b_id' || ':e2e:study:b1')::uuid, 'E2E-BETA-SUJ-001', 'screening'),
  (md5(:'org_b_id' || ':e2e:subject:b002')::uuid, :'org_b_id'::uuid, md5(:'org_b_id' || ':e2e:study:b1')::uuid, 'E2E-BETA-SUJ-002', 'screening'),
  (md5(:'org_b_id' || ':e2e:subject:b003')::uuid, :'org_b_id'::uuid, md5(:'org_b_id' || ':e2e:study:b1')::uuid, 'E2E-BETA-SUJ-003', 'screening')
ON CONFLICT (id) DO NOTHING;

-- '{}' es el perfil vacío inicial documentado por el esquema. No sobrescribir
-- perfiles existentes al repetir el seed: pueden contener resultados E2E.
INSERT INTO patient_profiles (organization_id, study_id, subject_id, profile_encrypted)
SELECT s.organization_id, s.study_id, s.id, :'profile_empty_encrypted'
FROM subjects s
WHERE (s.organization_id = :'org_a_id'::uuid AND s.subject_code IN ('E2E-SUJ-001','E2E-SUJ-002'))
   OR (s.organization_id = :'org_b_id'::uuid AND s.subject_code IN ('E2E-BETA-SUJ-001','E2E-BETA-SUJ-002','E2E-BETA-SUJ-003'))
ON CONFLICT (subject_id) DO NOTHING;
COMMIT;

SELECT o.name AS organization,
       count(DISTINCT si.id) AS centers,
       count(DISTINCT st.id) AS studies,
       count(DISTINCT su.id) AS subjects,
       count(DISTINCT pp.id) AS patient_profiles
FROM organizations o
LEFT JOIN sites si ON si.organization_id=o.id AND si.name IN ('Centro Ficticio Aurora E2E','Centro Ficticio Boreal E2E')
LEFT JOIN studies st ON st.organization_id=o.id AND st.protocol_number IN ('E2E-PROTOCOLO-001','E2E-PROT-GAMMA-002','E2E-PROT-BETA-003')
LEFT JOIN subjects su ON su.organization_id=o.id AND su.subject_code LIKE 'E2E-%'
LEFT JOIN patient_profiles pp ON pp.organization_id=o.id AND pp.subject_id=su.id
WHERE o.id IN (:'org_a_id'::uuid, :'org_b_id'::uuid)
GROUP BY o.id, o.name ORDER BY o.name;
