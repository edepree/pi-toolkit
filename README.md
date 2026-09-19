# pi-toolkit

An installable [Pi package](https://github.com/earendil-works/pi) containing **Janitor**, a deletion-first cleanup skill, and **`serial_subagent`**, blocking delegation to a worker or read-only reviewer.

> **Security:** This is context isolation, not a sandbox. Child extensions are disabled, so **parent permission/sandbox extensions and custom extension tools are not inherited**. Do not use delegation to bypass an explicit security restriction. Workers retain your filesystem and shell privileges; reviewer tool restrictions do not isolate filesystem access.
>
> **Scope:** Serialization is **within one Pi session**, not server-wide. Other Pi processes, extensions, clients, and deliberately launched shell agents are outside the guarantee. V1 supports **Linux with readable `/proc` and a Node-installed Pi** only. Other platforms fail before child launch; standalone compiled Pi distributions are not supported/tested.

## Install

```bash
pi install git:github.com/edepree/pi-toolkit
# Development/local install:
pi install /absolute/path/to/pi-toolkit
```

Restart Pi or use `/reload`. Add `-l` to install project-locally; Pi loads project resources only after the project is trusted. Review third-party instructions and code before installation.

## Use Janitor

In Pi:

```text
/skill:janitor
/skill:janitor Inspect src/ and recommend small cleanup actions; do not edit yet.
```

Janitor covers unused code, unnecessary complexity, dependencies, tests, documentation, and infrastructure configuration. It requires usage inspection before deletion, preserves behavior and meaningful coverage, protects unrelated edits, and validates small changes incrementally. State the scope and whether you want recommendations or edits. A worker can explicitly be directed to load Janitor; **Janitor is a skill, not a third agent role**.

The guidance is not enforcement. Inspect diffs and reported checks. No internal callers does not prove a public entrypoint is dead; failing tests must not be deleted merely to make checks green. Discovery tests do not prove model compliance, and no improvement over the already-safe pre-skill behavioral baseline has been demonstrated.

## Serial worker then reviewer

Ask the parent to call the tool with a **self-contained task**: objectives, paths, constraints, and completion criteria. Both `agent` and `task` are required; only `worker` and `reviewer` are accepted. Blank tasks fail before launch.

Example model tool calls, in order (not shell commands):

```javascript
serial_subagent({
  agent: "worker",
  task: "In src/parser.ts fix the documented empty-input bug only. Preserve unrelated changes. Add a regression test, run the parser tests, and report changed files, exact commands/results, and unresolved issues."
})
// Wait for the worker result. The parent then prepares the review evidence.
serial_subagent({
  agent: "reviewer",
  task: "Review src/parser.ts and tests/parser.test.ts against /tmp/parser-review.patch. The requested fix is empty-input handling only. Worker reports: npm test -- parser passed; treat that as supplied evidence, not independently verified. Report severity and file/line references for actionable findings, or no findings and limitations. Do not edit."
})
```

The parent or worker must save the relevant diff (for example, `git diff -- src/parser.ts tests/parser.test.ts > /tmp/parser-review.patch`) or put it directly in the review task. **The reviewer cannot run `git diff`, execute tests, or edit files.** Supply actual test evidence rather than copying the example's claim.

| Role | Actual built-in tool allowlist |
| --- | --- |
| Worker | `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls` |
| Reviewer | `read`, `grep`, `find`, `ls` |

The sequence is `Parent → Worker → Parent → Reviewer → Parent`. There is no automatic review loop, queue, scheduler, background mode, or agent registry. Use this tool instead of an asynchronous delegation tool for this workflow.

## Model, context, and trust

Each invocation starts a fresh, nonpersistent Pi subprocess in the parent's cwd with its explicit provider/model, thinking level, environment, and current project trust decision. No conversation history or extension-modified runtime prompt is copied. Normal project instructions and skill discovery remain subject to Pi's trust rules; global instructions and discovered skills can influence child behavior.

The child uses native **JSON RPC**. Before sending the task on stdin, the runner checks `get_state` for exact provider/model/thinking and a fresh idle session. Pi's CLI permits fuzzy model matching; a mismatch therefore fails **before inference**, rather than silently using a different model. The parent waits for `agent_settled` and successful process exit, not just an intermediate assistant message or `agent_end`. Progress uses ordinary tool UI updates only, never messages that trigger parent inference.

For native llama.cpp, configure Pi normally with `LLAMA_BASE_URL` and optional `LLAMA_API_KEY`. The child inherits those variables without putting credentials or the delegated task in command-line arguments. Select an already-loaded model in the parent. This extension does not load/unload router models or implement a custom provider. Child startup still needs Pi to discover that exact model; extension-only provider registrations are not inherited. Native Pi's own built-in llama.cpp integration remains available even when third-party extensions are disabled.

**Live-validation limitation:** The attempted Pi 0.85.1 smoke in an empty disposable agent directory failed before inference with `Unknown provider "llama.cpp"`, despite a reachable router and one loaded model. Native catalog/auth initialization in a cold environment still needs validation. Fixture and package-loader checks below are not proof of live llama.cpp handoff or request ordering.

## Cancellation, failures, and output

- Escape/tool cancellation and session shutdown use the same cleanup path. Linux process groups receive SIGTERM first, allowing Pi's normal detached-bash cleanup. After a 500 ms grace period, remaining owned processes/groups receive SIGKILL. `/proc` start-time identity checks guard against PID reuse. The serial slot is held until termination, including detached active tools; sending a signal is not treated as proof of exit.
- This is not containment of malicious/deliberately daemonized work. Linux processes stuck in uninterruptible kernel I/O may delay cancellation; the extension does not release the slot while known work remains live.
- Startup identity/prompt acceptance has a 30-second deadline. After settled completion, a child that fails to exit within 5 seconds is terminated and reported as failure. Tasks have no arbitrary runtime timeout; cancel them when needed.
- Launch/protocol/process/model failures, missing/invalid final reports, and cancellation fail explicitly. **Partial file edits remain.** Inspect the working tree before retrying; there is no automatic rollback or delegated-task relaunch.
- Only the final assistant report reaches parent model context. Model-visible output is at most **50 KiB or 2,000 lines**, including the truncation notice. Oversized reports are saved in a private temporary directory (0700) as a 0600 file; the result includes the full path. Read it with Pi's `read` tool, and delete it when no longer needed. Files remain available after the invocation.
- JSON records are limited to 8 MiB, stderr diagnostics to 4 KiB/40 lines, and progress contains only short status messages. Malformed/oversized records fail rather than accumulating an unbounded transcript. Known credential environment values are redacted from returned text and saved reports; this is not general secret detection or a reason to give the child secrets in its task.

## Requirements and development

- Minimum tested Pi: **0.85.1** (`@earendil-works/pi-coding-agent`), with sequential extension tools, native llama.cpp integration, and RPC `agent_settled`.
- Linux with readable `/proc`; tested with Node **26.7.0**. Use Node **22.19+** for Pi's development dependency (direct TypeScript execution uses Node type stripping).
- No runtime scheduling framework or extra runtime dependencies. Imported Pi/TypeBox packages are peers with pinned development versions. Pi loads production TypeScript directly; no build step.

```bash
npm ci --ignore-scripts
npm test
npm run check
npm pack --dry-run
git diff --check
```

Routine tests use Node test/assert and real fixture processes, not an inference service. They exercise registration/actual execution, flags, trust, fresh-state identity verification, protocol parsing, output bounds, failures, cancellation/escalation, Pi's actual detached bash backend, and subsequent calls. Package tests use Pi's real skill/resource loaders with isolated settings. `check` verifies this package against actual Pi API/RPC types; dependency declaration internals are skipped with `skipLibCheck`.

The package allowlist excludes tests, development plans, local configuration, and workflow logs. A separate packed install/list/resource-loader smoke uses disposable HOME and agent directories, leaving global settings untouched. Real worker/reviewer inference, parent/child request ordering, and real-model cancellation remain a separate validation gate, not a fixture-test claim.

## Attribution and licensing

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the pinned Universal Janitor source and the Pi subagent example reference, adaptation details, and complete applicable MIT notices. No license has been designated here for unrelated original repository code.
