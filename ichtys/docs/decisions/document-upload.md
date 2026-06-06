# Document Upload Decision

## Decision

Phase 3 uses the existing server route handler at
`POST /api/documents/upload`. The scaffold does not yet include a direct client
upload or presigned upload flow, so this phase keeps the simplest compatible
architecture and registers the document only after server-side validation.

The installed Blob SDK was updated to a version that supports private blobs.
Uploads use Vercel Blob with `access: 'private'`; API responses do not expose
the Blob URL or download URL.

## Tenant isolation

`organization_id` never comes from the client. The upload route rejects
`organization_id` and `organizationId` in FormData or query params before auth
or storage work starts. The internal organization UUID comes from
`validateStudyAccess(studyId)`, which resolves the active Clerk organization and
validates the selected study against that organization.

Both registry rows inherit this validated tenant boundary:

- `documents.organization_id = orgId`
- `documents.study_id = study.id`
- `document_versions.organization_id = orgId`
- `document_versions.study_id = study.id`

This duplication is intentional. It lets later reads enforce object-level
authorization directly on `document_versions`, pages, citations, and other
derived resources without trusting a client-provided org or study id.

## Status authorization

Document status is not authorized by a client `studyId`. It first validates the
`documentId` with object-level authorization, then reads the latest
`document_versions` row using the validated `organization_id` and `study_id`.
Resources outside the active org/study boundary remain indistinguishable from
missing resources and return `404 Not Found`.

## Storage access

Private Blob storage is mandatory for PDFs. Future download or preview work must
route through an authenticated endpoint or an equivalent signed-token mechanism
that revalidates document access before granting binary access.

## Upload size

This phase keeps server upload through the route handler and enforces a
conservative 4 MiB application limit. It does not claim robust 50MB support. To
support 50MB+ PDFs safely, add a direct/client Blob upload or presigned
multipart flow, then create `documents` and `document_versions` only after the
server validates the completed private blob and tenant scope.

## Audit policy

`document.upload` audit logs are mandatory. The audit row records
`organization_id`, `study_id`, `user_id`, `resource_type = document`,
`resource_id = documentId`, and metadata for the created document version,
document type, file size, and source file name. If audit insertion fails, the
request fails with a generic server error.

## Ingestion handoff

Upload stops after storing the private blob and creating a pending
`document_version`. Parsing, page extraction, and chunk creation are handled by
the ingestion phase using `documentVersionId` as the primary input. That keeps
future re-uploads unambiguous because the blob, status, page count, and error
message all belong to a specific version, not just the logical document.
