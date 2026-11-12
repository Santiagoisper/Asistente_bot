-- Seed sintético para validar aislamiento entre dos organizaciones y dentro de
-- una organización con dos estudios. Requiere esquema hasta migrations 0000-0015.
--
-- Destino de una corrida futura: una rama Neon desechable del proyecto
-- sweet-union-82704893, nunca Producción ni la rama compartida. No modifica
-- E2E-FICT-001 / E2E-001 ni filas ajenas: usa claves propias y UUIDs derivados.
-- Las dos organizaciones deben preexistir en Clerk de prueba y en la BD aislada.
-- Se resuelven por clerk_org_id; este seed no crea ni renombra organizaciones.
--
-- psql "$E2E_DATABASE_URL" \
--   -v target_confirmation=DISPOSABLE_TEST_DB \
--   -v clerk_org_id_a="$CLERK_TEST_ORG_ID_A" \
--   -v clerk_org_id_b="$CLERK_TEST_ORG_ID_B" \
--   -f ichtys/scripts/e2e/seed-os-e2e-sintetica.sql

\set ON_ERROR_STOP on

\if :{?target_confirmation}
\else
  \echo 'ERROR: falta target_confirmation=DISPOSABLE_TEST_DB o ISOLATED_PREVIEW.'
  \quit 3
\endif
SELECT :'target_confirmation' IN ('DISPOSABLE_TEST_DB', 'ISOLATED_PREVIEW') AS target_is_safe \gset
\if :target_is_safe
\else
  \echo 'ERROR: destino no permitido; no se sembró nada.'
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

SELECT id::text AS org_a_id, name AS org_a_name
FROM organizations WHERE clerk_org_id = :'clerk_org_id_a' \gset
\if :{?org_a_id}
\else
  \echo 'ERROR: clerk_org_id_a no corresponde a una organización preexistente.'
  \quit 3
\endif
SELECT id::text AS org_b_id, name AS org_b_name
FROM organizations WHERE clerk_org_id = :'clerk_org_id_b' \gset
\if :{?org_b_id}
\else
  \echo 'ERROR: clerk_org_id_b no corresponde a una organización preexistente.'
  \quit 3
\endif
SELECT :'org_a_name' = 'OS-E2E-SINTETICA' AS org_a_ok,
       :'org_b_name' = 'OS-E2E-SINTETICA-2' AS org_b_ok,
       :'org_a_id' <> :'org_b_id' AS orgs_distinct \gset
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

-- Org A tiene dos estudios en el mismo tenant. El primero coincide con el PDF.
-- Sus dos sujetos también tienen perfiles iniciales vacíos ({} cifrado por app).
-- Abortar si alguno de los IDs reservados ya pertenece a otra fila.
WITH expected_sites(id, organization_id, name) AS (VALUES
  (md5(:'org_a_id' || ':e2e:site:a')::uuid, :'org_a_id'::uuid, 'Centro Ficticio Aurora E2E'),
  (md5(:'org_b_id' || ':e2e:site:b')::uuid, :'org_b_id'::uuid, 'Centro Ficticio Boreal E2E')
), expected_studies(id, organization_id, name, protocol_number) AS (VALUES
  (md5(:'org_a_id' || ':e2e:study:a1')::uuid, :'org_a_id'::uuid, 'E2E Estudio Alfa', 'E2E-PROTOCOLO-001'),
  (md5(:'org_a_id' || ':e2e:study:a2')::uuid, :'org_a_id'::uuid, 'E2E Estudio Gamma', 'E2E-PROT-GAMMA-002'),
  (md5(:'org_b_id' || ':e2e:study:b1')::uuid, :'org_b_id'::uuid, 'E2E Estudio Beta', 'E2E-PROT-BETA-003')
), expected_subjects(id, organization_id, study_id, subject_code) AS (VALUES
  (md5(:'org_a_id' || ':e2e:subject:a001')::uuid, :'org_a_id'::uuid, md5(:'org_a_id' || ':e2e:study:a1')::uuid, 'E2E-SUJ-001'),
  (md5(:'org_a_id' || ':e2e:subject:a002')::uuid, :'org_a_id'::uuid, md5(:'org_a_id' || ':e2e:study:a2')::uuid, 'E2E-SUJ-002'),
  (md5(:'org_b_id' || ':e2e:subject:b001')::uuid, :'org_b_id'::uuid, md5(:'org_b_id' || ':e2e:study:b1')::uuid, 'E2E-BETA-SUJ-001'),
  (md5(:'org_b_id' || ':e2e:subject:b002')::uuid, :'org_b_id'::uuid, md5(:'org_b_id' || ':e2e:study:b1')::uuid, 'E2E-BETA-SUJ-002'),
  (md5(:'org_b_id' || ':e2e:subject:b003')::uuid, :'org_b_id'::uuid, md5(:'org_b_id' || ':e2e:study:b1')::uuid, 'E2E-BETA-SUJ-003')
)
SELECT NOT EXISTS (SELECT 1 FROM sites a JOIN expected_sites e USING (id)
                   WHERE a.organization_id<>e.organization_id OR a.name<>e.name)
   AND NOT EXISTS (SELECT 1 FROM studies a JOIN expected_studies e USING (id)
                   WHERE a.organization_id<>e.organization_id OR a.name<>e.name
                      OR a.protocol_number IS DISTINCT FROM e.protocol_number)
   AND NOT EXISTS (SELECT 1 FROM subjects a JOIN expected_subjects e USING (id)
                   WHERE a.organization_id<>e.organization_id OR a.study_id<>e.study_id
                      OR a.subject_code<>e.subject_code) AS ids_safe \gset
\if :ids_safe
\else
  \echo 'ERROR: ID reservado existente con datos diferentes; no se sembró nada.'
  \quit 3
\endif

BEGIN;
INSERT INTO sites (id, organization_id, name) VALUES
  (md5(:'org_a_id' || ':e2e:site:a')::uuid, :'org_a_id'::uuid, 'Centro Ficticio Aurora E2E'),
  (md5(:'org_b_id' || ':e2e:site:b')::uuid, :'org_b_id'::uuid, 'Centro Ficticio Boreal E2E')
ON CONFLICT (id) DO UPDATE SET organization_id=EXCLUDED.organization_id, name=EXCLUDED.name;

INSERT INTO studies (id, organization_id, site_id, name, protocol_number, status) VALUES
  (md5(:'org_a_id' || ':e2e:study:a1')::uuid, :'org_a_id'::uuid, md5(:'org_a_id' || ':e2e:site:a')::uuid, 'E2E Estudio Alfa', 'E2E-PROTOCOLO-001', 'active'),
  (md5(:'org_a_id' || ':e2e:study:a2')::uuid, :'org_a_id'::uuid, md5(:'org_a_id' || ':e2e:site:a')::uuid, 'E2E Estudio Gamma', 'E2E-PROT-GAMMA-002', 'active'),
  (md5(:'org_b_id' || ':e2e:study:b1')::uuid, :'org_b_id'::uuid, md5(:'org_b_id' || ':e2e:site:b')::uuid, 'E2E Estudio Beta', 'E2E-PROT-BETA-003', 'active')
ON CONFLICT (id) DO UPDATE SET organization_id=EXCLUDED.organization_id, site_id=EXCLUDED.site_id,
  name=EXCLUDED.name, protocol_number=EXCLUDED.protocol_number, status=EXCLUDED.status, updated_at=now();

INSERT INTO subjects (id, organization_id, study_id, subject_code, status) VALUES
  (md5(:'org_a_id' || ':e2e:subject:a001')::uuid, :'org_a_id'::uuid, md5(:'org_a_id' || ':e2e:study:a1')::uuid, 'E2E-SUJ-001', 'screening'),
  (md5(:'org_a_id' || ':e2e:subject:a002')::uuid, :'org_a_id'::uuid, md5(:'org_a_id' || ':e2e:study:a2')::uuid, 'screening'),
  (md5(:'org_b_id' || ':e2e:subject:b001')::uuid, :'org_b_id'::uuid, md5(:'org_b_id' || ':e2e:study:b1')::uuid, 'screening'),
  (md5(:'org_b_id' || ':e2e:subject:b002')::uuid, :'org_b_id'::uuid, md5(:'org_b_id' || ':e2e:study:b1')::uuid, 'screening'),
  (md5(:'org_b_id' || ':e2e:subject:b003')::uuid, :'org_b_id'::uuid, md5(:'org_b_id' || ':e2e:study:b1')::uuid, 'screening')
ON CONFLICT (id) DO UPDATE SET organization_id=EXCLUDED.organization_id, study_id=EXCLUDED.study_id,
  subject_code=EXCLUDED.subject_code, status=EXCLUDED.status, updated_at=now();

INSERT INTO patient_profiles (organization_id, study_id, subject_id, profile_encrypted)
SELECT s.organization_id, s.study_id, s.id, '{}'
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
