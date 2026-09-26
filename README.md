# pi-toolkit

A [Pi package](https://github.com/earendil-works/pi) with **Janitor**, a deletion-first cleanup skill, **Code Simplifier**, a behavior-preserving refinement skill, and **`serial_subagent`**, a blocking handoff to a worker or read-only reviewer.

> **Security:** This is context isolation, not a sandbox. Child extensions are disabled, so parent permission/sandbox extensions are **not inherited**. Workers have your full filesystem and shell privileges. Serialization is per Pi session, not server-wide. Linux (`/proc`) and a Node-installed Pi only.

## Install

```bash
pi install git:github.com/edepree/pi-toolkit   # or: pi install /path/to/pi-toolkit
```

Then restart Pi or run `/reload`.

## Janitor

```text
/skill:janitor Inspect src/ and recommend small cleanup actions; do not edit yet.
```

Say what's in scope and whether you want recommendations or edits. This is guidance, not enforcement, so review the diff.

## Code Simplifier

```text
/skill:code-simplifier
/skill:code-simplifier Refine src/parser.ts only.
```

By default it refines only uncommitted changes, following the project's own conventions. It runs checks before and after, and it doesn't delete features or dependencies (use Janitor for that).

## serial_subagent

The parent model calls the tool with an `agent` name and a self-contained `task` covering objectives, paths, constraints and completion criteria. No conversation history is copied.

Agents are defined in [`agents/`](agents): [`worker`](agents/worker.md) edits files and runs checks, and [`reviewer`](agents/reviewer.md) is read-only. Each file's frontmatter sets `name` (the `agent` value), `description` (shown to the parent model) and `tools` (the child's tool allowlist). The body is appended to the child's system prompt. Adding a file adds an agent.

Typical flow: `parent → worker → parent → reviewer → parent`. The reviewer can't run `git diff` or tests, so include the diff (or a saved patch path) and the worker's test output in the review task.

Behavior:

- Each call starts a fresh `pi --mode rpc --no-session --no-extensions` child in the parent's cwd, with the parent's provider, model, thinking level, environment and project trust.
- The task is sent over stdin only after `get_state` confirms the exact model and a fresh session. A mismatch fails before any inference.
- Cancellation or session shutdown sends SIGTERM to the child's process group, waits briefly, then sends SIGKILL to any remaining descendants. Another call can't start until they have exited.
- Startup has a timeout. The task itself has none; cancel it if needed.
- Failures return an error. **Partial edits remain**: there's no rollback or retry.
- While running, the tool row shows ⏳, token usage, and the child's latest tool calls and notes (redacted, one line each). Only the final assistant report is returned. If it exceeds Pi's default tool output limit, it's truncated and the full report is saved to a private temp file whose path is in the result.
- Values of environment variables that look like credentials are redacted from output.

For llama.cpp, set `LLAMA_BASE_URL` (and optionally `LLAMA_API_KEY`); the child inherits them. The child only sees models Pi knows at startup, so a new Pi agent directory may need one normal session to populate `models-store.json` first.

## Development

Tested with the Pi version in `package.json` `devDependencies` and Node 26. Node 22.19+ is required to run TypeScript without a build step.

```bash
npm ci --ignore-scripts && npm test && npm run check
```

## Attribution

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
