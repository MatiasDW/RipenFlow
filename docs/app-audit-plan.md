# Application Audit Plan

## Purpose
This document captures the current audit baseline for RipenFlow and turns it into an execution plan. It focuses on:

- security,
- quality,
- frontend robustness,
- performance,
- and codebase hygiene.

It reflects the repository state reviewed on 2026-04-18.

## Current baseline

- Frontend: React 19 + Vite + TypeScript.
- Routing: TanStack Router.
- Data cache: TanStack Query.
- Database: PostgreSQL + Drizzle.
- File ingestion: Excel and CSV parsing in the browser via `xlsx`.
- No backend HTTP layer yet.
- No authentication or authorization layer yet.
- No automated test suite in the repository yet.

## Improvements already applied

- Added operational limits for Excel and CSV ingestion.
- Added required-column validation for intake files.
- Reduced intake preview memory usage by storing sample rows instead of all parsed rows in the preview model.
- Replaced the sample `leads` schema with import-oriented tables.
- Removed the artificial UI delay from the stack cards loader.
- Hardened the Docker Postgres default setup by removing `trust` auth and binding ports to localhost.
- Updated package naming and README content to align with the actual project.

## Main findings

### High severity

1. The application still has no application-layer security model.
   Current state:
   - no auth,
   - no roles,
   - no ownership model,
   - no audit trail,
   - no server-side validation boundary.

   Risk:
   Once write operations, imports, or planning actions move to a backend, the absence of an explicit security model will create rushed and fragile access control.

2. There is no automated quality gate.
   Current state:
   - no test suite,
   - no CI pipeline,
   - no required build verification in the repo itself.

   Risk:
   Parser regressions, schema drift, and UI behavior regressions can ship unnoticed.

3. The frontend still performs parsing in the browser.
   Reference:
   [src/lib/purchase-file.ts](/Users/Matt/conductor/workspaces/RipenFlow/bangalore/src/lib/purchase-file.ts:118)

   Risk:
   The new limits reduce exposure, but parsing remains a client-side concern. Large or malformed files can still create a poor UX, and the browser is not the ideal trust boundary for business-critical imports.

### Medium severity

1. The intake screen is a monolithic route module.
   Reference:
   [src/router.tsx](/Users/Matt/conductor/workspaces/RipenFlow/bangalore/src/router.tsx:1)

   Risk:
   UI rendering, parsing workflow, validation messaging, and page layout live in one file. This slows down maintainability, testing, and future feature work such as mapping flows or persistence.

2. Several user-facing strings remain hardcoded in Spanish.
   Reference:
   [src/router.tsx](/Users/Matt/conductor/workspaces/RipenFlow/bangalore/src/router.tsx:29)

   Risk:
   This blocks i18n planning and makes the UI harder to standardize if the product needs English or multi-locale support.

3. Static data is still routed through React Query.
   References:
   [src/router.tsx](/Users/Matt/conductor/workspaces/RipenFlow/bangalore/src/router.tsx:109)
   [src/lib/stack-data.ts](/Users/Matt/conductor/workspaces/RipenFlow/bangalore/src/lib/stack-data.ts:1)

   Risk:
   It is not functionally incorrect, but it adds indirection and cache machinery for data that is currently local and static.

4. The development Vite server still binds to `0.0.0.0`.
   Reference:
   [vite.config.ts](/Users/Matt/conductor/workspaces/RipenFlow/bangalore/vite.config.ts:8)

   Risk:
   This is acceptable for local container workflows, but it should remain explicitly development-only and documented as such.

### Low severity

1. Some code and UI labels mix product intent, demo wording, and domain notes.
   Risk:
   The repo reads partly like a scaffold and partly like a production feature, which can confuse future implementation decisions.

2. Asset cleanup is still incomplete.
   Risk:
   There may still be leftover non-critical files from scaffolding that should be pruned once the environment allows it cleanly.

## Failure scenarios to test

### Intake failures

- File exceeds the configured maximum size.
- Workbook exceeds maximum sheet count.
- A single sheet exceeds row limit.
- Combined workbook rows exceed total row limit.
- A sheet exceeds column limit.
- Workbook has no sheets.
- Workbook has only helper sheets and none match required business columns.
- Headers are duplicated and normalize to the same key.
- Numeric identifiers were already rounded by Excel before upload.
- User selects file A and immediately selects file B.

### UI failures

- Long warning lists push the layout too far on mobile.
- Very long column names create unreadable chip and table layouts.
- Extremely wide sheets degrade the preview table UX.
- Error state is visible but not announced to assistive technologies.
- Keyboard users do not get strong focus affordances on interactive elements.

### Future backend failures

- Import rows are persisted without provenance metadata.
- Invalid rows are partially saved without a recoverable import status.
- Schema changes break downstream planning assumptions.
- Business rules diverge between frontend parsing and backend persistence.

## Improvement roadmap

### Phase 1. Stabilize the frontend intake

- Split the intake route into smaller components and utilities.
- Move copy strings into a structured content layer.
- Add accessible status and error announcements.
- Add focus-visible states for buttons, tabs, and links.
- Add tests for parser edge cases and intake state transitions.

### Phase 2. Create a real import pipeline

- Move trust boundaries to the backend.
- Persist import metadata and row-level validation results.
- Add explicit import statuses such as `received`, `validated`, `rejected`, `persisted`.
- Introduce structured domain validation after raw file parsing.

### Phase 3. Add quality gates

- Add test runners and baseline coverage for parser and UI.
- Add CI for `lint`, `build`, and tests.
- Add migration verification for Drizzle schema changes.
- Add dependency review and vulnerability scanning.

### Phase 4. Prepare for production-grade security

- Define user roles and authorization boundaries.
- Add audit logging for imports and planning actions.
- Add secret management conventions beyond local `.env`.
- Add server-side request validation and rate limiting.

## Acceptance criteria

The audit plan can be considered successful when:

- file imports fail safely and predictably,
- the frontend is modular enough to test and extend,
- schema and import behavior are backed by automated checks,
- Docker defaults no longer normalize insecure patterns,
- and the future backend path is clearly defined before business writes are introduced.

## Verification performed for this audit

- Reviewed the current intake route, parser, CSS, query client, and Vite config.
- Confirmed recent hardening changes in parser and Docker config.
- Confirmed there is still no automated test suite in the repository.
- `bun run lint` and `bun run build` were not executable in this environment because `bun` is not installed here.
