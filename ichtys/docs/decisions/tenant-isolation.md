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
