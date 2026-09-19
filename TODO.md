# Pi toolkit design

- [x] Inspect repository, package documentation, Janitor source, and Pi subagent example.
- [x] Clarify serial subagent requirements: two fixed roles (worker and reviewer), strictly serial; native llama.cpp via LLAMA_BASE_URL.
- [x] Compare minimal implementation approaches: blocking subprocess (recommended) versus in-process SDK session.
- [x] Present and approve package, skill, and extension design (worker plus read-only reviewer).
- [x] Write the approved design specification: docs/superpowers/specs/2026-09-19-pi-toolkit-design.md.
- [x] Review specification for completeness, consistency, scope, and ambiguity.
- [x] Obtain user review of the written specification.
- [x] Create implementation plan after approval: docs/superpowers/plans/2026-09-19-pi-toolkit.md.
- [ ] Task 1: package and Janitor skill, including validation and independent review.
- [ ] Task 2: serial worker/reviewer extension, tests, usage docs, and independent review.
- [ ] Final branch review and fresh verification; report integration options.

Visual companion: not needed for this nonvisual design.
