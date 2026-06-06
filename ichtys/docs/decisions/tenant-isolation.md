# Tenant Isolation Decisions

## Decision

`organization_id` comes exclusively from the Clerk server-side token. API
requests must never accept it from a body, query string, header, or client-side
state. Routes that need the internal organization UUID resolve it through
`validateStudyAccess()`.

`study_id` is client-provided only as a selector, then validated against the
database by crossing it with the organization from the Clerk token. No data
access can run before this validation.

`documentId` and `messageId` must also be validated against the active
organization and study before returning document status, pages, citations, or
derived resources. The current route stubs include release-blocking TODOs for
these guards until the database-backed reads are connected.

Resources outside the active organization or study return `404 Not Found`, not
`403 Forbidden`. This avoids enumeration leakage by keeping "does not exist" and
"exists elsewhere" indistinguishable to the caller.

## Release Gate

Tenant isolation tests are blocking for release. At minimum, CI must cover:

- unauthenticated requests
- requests without an active Clerk organization
- studies that do not belong to the active organization
- routes rejecting client-provided `organization_id`
- API routes returning 404 for resources outside the active org/study boundary

## Risks

If this layer breaks, a user could retrieve clinical documents, document states,
messages, citations, or answer evidence from another organization or another
study. In a regulated clinical workflow, that is a tenant data leakage incident,
not a recoverable UI defect.

## Object-level authorization

Validating `study_id` is not enough when an endpoint receives a concrete object
id. The object itself must prove its tenancy in DB before any response exposes
status, page, citation, message, or related resource data.

- `documentId` is authorized through `documents.id` +
  `documents.organization_id`; then `documents.study_id` is checked against
  `studies.organization_id`.
- document page access validates the document first, then validates the
  document version and page with the same `organization_id` and `study_id`.
- `messageId` is authorized through `messages.id` +
  `messages.organization_id`; then `messages.study_id` is checked against
  `studies.organization_id`.
- citations are read only with `message_id` + `organization_id` + `study_id`
  derived from the validated message.
- client-provided `organization_id` and `study_id` are ignored for object-level
  authorization on these routes.

Object-level authorization tests for document status, document page access,
messages, and citations are release-blocking.

## Document upload registry

Document upload follows the same tenant boundary:

- `studyId` may be supplied by the client only as a selector and is validated
  with `validateStudyAccess()` before storage or DB writes.
- `organization_id` is rejected from FormData, JSON bodies, and query params.
- `documents.organization_id` and `document_versions.organization_id` are set
  from the Clerk-derived internal org UUID, never from client input.
- `documents.study_id` and `document_versions.study_id` are set from the
  validated study row.
- The upload response excludes Blob URLs and organization identifiers.

Every later document status, page, citation, or binary download path must still
perform object-level authorization. A stored `document_version` row is not a
permission grant by itself; it is tenant metadata used to enforce the same
org/study boundary on future reads.
