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

The parent model calls the tool with `agent` (`worker` or `reviewer`) and a self-contained `task` covering objectives, paths, constraints and completion criteria. No conversation history is copied.

| Role | Tools |
| --- | --- |
| Worker | `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls` |
| Reviewer | `read`, `grep`, `find`, `ls` |

Flow: `parent → worker → parent → reviewer → parent`. The reviewer can't run `git diff` or tests, so put the diff (or a saved patch path) and the worker's test output in the review task.

Behavior:

- Each call starts a fresh `pi --mode rpc --no-session --no-extensions` child in the parent's cwd, with the parent's provider, model, thinking level, environment and project trust.
- The task is sent over stdin only after `get_state` confirms the exact model and a fresh session. A mismatch fails before any inference.
- Cancellation or session shutdown sends SIGTERM to the child's process group, waits 500 ms, then sends SIGKILL to any remaining descendants. The slot stays busy until they're dead.
- Startup has a 30 s deadline. There's no task timeout; cancel it yourself if needed.
- Failures are explicit. **Partial edits remain**: there's no rollback or retry.
- While running, the tool row shows ⏳, live usage, and the child's last 5 tool calls/notes (redacted, one line each). Only the final assistant report is returned. If it exceeds 50 KiB or 2,000 lines, it's truncated and the full report is saved to a private temp file (the path is in the result).
- Known credential env values are redacted from output.

For native llama.cpp, set `LLAMA_BASE_URL` (and optionally `LLAMA_API_KEY`) as usual; the child inherits them. The child can only resolve models Pi knows at startup, so a cold agent directory may need one normal session to populate `models-store.json` first.

## Development

Tested on Pi 0.85.1 and Node 26 (Node 22.19+ required for TypeScript type stripping). There's no build step.

```bash
npm ci --ignore-scripts && npm test && npm run check
```

## Attribution

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
