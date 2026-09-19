# pi-toolkit

An installable [Pi package](https://github.com/earendil-works/pi) with **Janitor**, a deletion-first codebase cleanup skill adapted from GitHub Awesome Copilot's Universal Janitor.

This increment contains the skill only. The serial worker/reviewer extension is not included yet. Janitor is a skill, not a subagent role.

## Install

```bash
pi install git:github.com/edepree/pi-toolkit
# Local checkout (use this to test changes before they reach the remote):
pi install /absolute/path/to/pi-toolkit
```

Restart Pi or run `/reload` after installing. Add `-l` to `pi install` for a project-local installation; Pi loads project resources only after the project is trusted. Review third-party skill instructions before using them: skills can direct actions with the agent's tools and are not a sandbox.

## Use Janitor

In Pi:

```text
/skill:janitor
/skill:janitor Inspect src/ and recommend small cleanup actions; do not edit yet.
```

Janitor covers unused code, unnecessary complexity, dependency hygiene, tests, documentation, and infrastructure configuration. It calls for usage inspection before deletion, preserves behavior and meaningful coverage, protects unrelated edits, and validates small changes incrementally. State the scope and whether you want recommendations or edits. A worker can be explicitly instructed to use this skill; no delegation tool is required.

The guidance is not an enforcement mechanism. The selected model and available tools determine actual behavior; inspect diffs and reported checks. Do not treat an absence of internal callers as proof of dead public code, or remove failing tests just to make checks green.

## Requirements and development

- Minimum tested Pi: **0.85.1** (`@earendil-works/pi-coding-agent`). This release supports the native llama.cpp provider and sequential extension tools; the skill itself is provider-independent and performs no model management.
- Node **22.18+** supports direct TypeScript test execution through built-in type stripping. The pinned Pi **0.85.1** development dependency requires Node **22.19+**, so use at least 22.19 for the full suite. Tested here with Node **26.7.0** on Linux.
- No runtime framework or extra runtime dependencies. The Pi package is declared as a peer per Pi packaging guidance, and pinned as a development dependency for discovery tests. The skill is Markdown; Pi loads production TypeScript resources itself when present, without a package build step.

From the checkout root:

```bash
npm ci --ignore-scripts
npm test
npm pack --dry-run
git diff --check
```

`tests/package.test.ts` checks the manifest and uses Pi's actual skill loader to validate frontmatter/discovery without loading global or project settings. It requires the installed development dependency, not a running inference service. The package file allowlist excludes tests, development plans, local configuration, and workflow logs from the tarball.

Discovery tests do **not** prove that a model follows the skill. Behavioral evaluation is separate. The pre-skill cleanup scenario already produced safe recommendations, so no improvement over that baseline has been demonstrated.

## Attribution and licensing

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the pinned upstream source, adaptation details, and complete MIT notice for the Janitor material. No license has been designated here for unrelated original repository code.
