# Frontend Audit

## Scope
This audit covers the current React frontend, with emphasis on:

- architecture,
- usability,
- accessibility,
- resilience,
- performance,
- and maintainability.

## Reviewed files

- [src/router.tsx](/Users/Matt/conductor/workspaces/RipenFlow/bangalore/src/router.tsx:1)
- [src/lib/purchase-file.ts](/Users/Matt/conductor/workspaces/RipenFlow/bangalore/src/lib/purchase-file.ts:1)
- [src/index.css](/Users/Matt/conductor/workspaces/RipenFlow/bangalore/src/index.css:1)
- [src/main.tsx](/Users/Matt/conductor/workspaces/RipenFlow/bangalore/src/main.tsx:1)
- [src/lib/query-client.ts](/Users/Matt/conductor/workspaces/RipenFlow/bangalore/src/lib/query-client.ts:1)
- [vite.config.ts](/Users/Matt/conductor/workspaces/RipenFlow/bangalore/vite.config.ts:1)

## Findings

### High priority

1. The route component is carrying too many responsibilities.
   Reference:
   [src/router.tsx](/Users/Matt/conductor/workspaces/RipenFlow/bangalore/src/router.tsx:108)

   Evidence:
   - intake copy,
   - parsing workflow,
   - warnings merging,
   - file-selection concurrency handling,
   - summary rendering,
   - sheet navigation,
   - table preview,
   - and stack-card rendering all live in one module.

   Impact:
   This will become difficult to evolve once the app adds column mapping, server uploads, import history, or persistence workflows.

2. The frontend still has no automated behavior coverage.
   Impact:
   The current parser and intake state logic are business-significant. Without tests, regressions in file handling are likely.

### Medium priority

1. Accessibility states are incomplete.
   References:
   [src/router.tsx](/Users/Matt/conductor/workspaces/RipenFlow/bangalore/src/router.tsx:221)
   [src/index.css](/Users/Matt/conductor/workspaces/RipenFlow/bangalore/src/index.css:212)

   Evidence:
   - error and warning messages do not use `aria-live`,
   - the hidden file input is triggered by a button rather than an associated visible label,
   - there are no visible `:focus-visible` styles for keyboard users,
   - tabs are visually rendered as buttons but do not expose tablist semantics.

   Impact:
   The page is usable for many users, but not robustly accessible.

2. The UI content layer is hardcoded.
   References:
   [src/router.tsx](/Users/Matt/conductor/workspaces/RipenFlow/bangalore/src/router.tsx:21)
   [src/router.tsx](/Users/Matt/conductor/workspaces/RipenFlow/bangalore/src/router.tsx:29)

   Impact:
   Product copy, expected fields, domain notes, and layout content all live inline. This blocks localization and makes copy changes unnecessarily coupled to UI code.

3. The preview experience is not yet designed for large operational complexity.
   References:
   [src/router.tsx](/Users/Matt/conductor/workspaces/RipenFlow/bangalore/src/router.tsx:327)
   [src/index.css](/Users/Matt/conductor/workspaces/RipenFlow/bangalore/src/index.css:344)

   Evidence:
   - wide tables are handled only by horizontal scrolling,
   - there is no sticky header,
   - there is no filtering, search, or column mapping support,
   - there is no distinction between valid, missing, and suspicious cell values in the preview.

   Impact:
   The intake screen is acceptable for a basic bootstrap flow, but not yet strong enough for operational imports.

4. Static content still uses query infrastructure.
   References:
   [src/router.tsx](/Users/Matt/conductor/workspaces/RipenFlow/bangalore/src/router.tsx:109)
   [src/lib/query-client.ts](/Users/Matt/conductor/workspaces/RipenFlow/bangalore/src/lib/query-client.ts:3)

   Impact:
   Using React Query for local static stack cards is not harmful, but it introduces unnecessary cognitive overhead and cache semantics where a plain constant would be simpler.

### Low priority

1. Language consistency is not yet defined.
   The current UI remains in Spanish while the audit and engineering documentation are moving to English. A product-level language strategy should be chosen soon.

2. The current page is visually polished but operationally early-stage.
   The design direction is already stronger than a default scaffold, but the interaction model is still a single-screen proof of flow rather than a production-grade intake interface.

## Cases found during review

### Good patterns already present

- The parser now rejects oversized or structurally excessive files early.
- Concurrent file-selection handling avoids stale async updates.
- Devtools are correctly limited to development mode in [src/main.tsx](/Users/Matt/conductor/workspaces/RipenFlow/bangalore/src/main.tsx:21).
- The layout already adapts to smaller screens via media queries in [src/index.css](/Users/Matt/conductor/workspaces/RipenFlow/bangalore/src/index.css:395).

### Weak points still present

- Parsing still happens in the browser.
- The intake route is still tightly coupled to presentation.
- Accessibility semantics are incomplete.
- There is no server-backed import lifecycle.
- There are no frontend tests.

## Potential failure modes

### UX failures

- Users may not understand why one sheet is accepted and another is only warned about.
- Long warning lists can become noisy without grouping or severity levels.
- The preview can remain technically correct but operationally hard to read for complex files.

### Accessibility failures

- Screen readers may not announce file-processing errors at the right moment.
- Keyboard users may lose orientation due to weak focus treatment.
- Sheet buttons may not behave like fully accessible tabs.

### Architecture failures

- Future backend integration may duplicate validation logic currently embedded in the route.
- A column-mapping feature added directly into this page could turn the route into an oversized maintenance bottleneck.
- Future import history, saved drafts, or partial validation states will be hard to compose if the screen remains monolithic.

## Recommended frontend plan

### Step 1. Refactor the intake page

- Extract `UploadPanel`, `WorkbookSummary`, `WorkbookWarnings`, `SheetTabs`, and `SheetPreview`.
- Move intake copy and expected-field metadata into a dedicated content/config module.
- Keep parsing helpers in their own module boundary.

### Step 2. Improve accessibility

- Add `aria-live` regions for error and warning feedback.
- Add `:focus-visible` styling for all interactive controls.
- Add explicit semantics for tabs and status messages.
- Re-evaluate the hidden file input interaction for assistive technology clarity.

### Step 3. Improve operational UX

- Add a clearer distinction between blocking errors and non-blocking warnings.
- Add sheet-level validation summaries.
- Add basic column validation indicators in the preview.
- Add import guidance for users before they upload.

### Step 4. Add tests

- Unit tests for parser limits and header normalization.
- Component tests for loading, error, warning, and valid preview states.
- Regression tests for rapid re-selection of files.

## Suggested acceptance criteria

- The intake screen is broken into composable units.
- Error and warning flows are accessible.
- Users can understand why a file is accepted, rejected, or only partially usable.
- Parser behavior is covered by automated tests.
- Frontend logic is ready to hand off parsed results to a future backend import pipeline.
