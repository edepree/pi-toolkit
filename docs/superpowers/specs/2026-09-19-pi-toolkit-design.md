# Pi Toolkit V1 design

## Goal

Make this repository an installable Pi package containing a Janitor skill and a blocking serial-subagent extension. The primary environment is Pi's native llama.cpp provider configured with `LLAMA_BASE_URL` and, optionally, `LLAMA_API_KEY`.

Delegation must avoid parent/child inference interleaving: the parent waits while one child completes its task, then receives the result. Switching context into the child and back is unavoidable; eliminating those two switches or preserving llama.cpp KV caches is not a goal.

## Package

Declare the `pi-package` keyword and explicit extension and skill paths in `package.json`. Ship:

- `skills/janitor/SKILL.md`
- `extensions/serial-subagent.ts`
- `README.md` with installation, usage, requirements, and limitations
- Required third-party attribution/license notices

Use Node built-ins and Pi's provided packages; no runtime scheduling framework or additional runtime dependencies. Declare imported Pi packages as peer dependencies as required by Pi's package documentation. Keep tests outside extension discovery. Document the minimum tested Pi version, including support for sequential tools and the native llama.cpp provider.

## Janitor skill

Adapt GitHub Awesome Copilot's Universal Janitor agent into a Pi skill named `janitor`. Preserve its deletion-first philosophy and coverage of unused code, unnecessary complexity, dependencies, tests, documentation, and infrastructure configuration.

Replace VS Code-specific metadata and MCP assumptions with Pi-compatible instructions. Preserve upstream attribution and applicable license notices. Add explicit safeguards:

- Inspect usage and establish the requested scope before deleting anything.
- Preserve behavior, security, accessibility, and meaningful test coverage.
- Do not delete a failing or flaky test merely to make checks pass.
- Make small changes and run relevant checks; report checks that could not run.
- Preserve unrelated user changes and avoid unrequested dependency migrations or destructive infrastructure operations.

Janitor is a skill, not a third subagent role. The worker can be explicitly directed to use it.

## Serial-subagent interface

One model-callable tool:

```text
serial_subagent({ agent: "worker" | "reviewer", task: "..." })
```

Both fields are required. Reject unknown roles and empty/whitespace-only tasks before launch. The task is a self-contained delegation brief: objectives, relevant paths, constraints, and completion criteria. The task is sent on stdin only after startup identity verification. The parent must include relevant prior results explicitly; no conversation history is copied implicitly.

### Fixed roles

| Role | Tools | Contract |
| --- | --- | --- |
| `worker` | `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls` | Implement the scoped task, run relevant checks, report changed files, results, and unresolved issues. |
| `reviewer` | `read`, `grep`, `find`, `ls` | Inspect the specified files and supplied evidence; report actionable findings with file/line references and severity, or explicitly state no findings and remaining limitations. |

Reviewer access is restricted by the actual tool allowlist, not just instructions. It cannot edit files, execute shell commands, run `git diff`, or rerun tests. The parent must supply a diff or point to a saved diff when needed. Worker test reports are evidence to assess, not independently verified test results.

Role instructions are fixed within the extension. There are no user-defined agent profiles, discovery directories, or configurable role registry.

## Execution and data flow

Use a blocking subprocess adapted from Pi's subagent example rather than an in-process SDK session. This provides a fresh process and a clear lifetime without managing multiple SDK runtimes in the parent.

1. Validate arguments and require an active parent model.
2. Run the tool in Pi's native sequential execution mode so sibling parent tools cannot overlap it. Maintain a defensive busy guard; reject unexpected concurrent entry rather than build a queue.
3. Launch a fresh, nonpersistent Pi session in native JSON RPC mode using the parent's working directory, selected provider/model, thinking level, and inherited environment. Do not resume or fork the parent session.
   Verify the child’s exact provider/model/thinking and fresh idle state through RPC `get_state` **before** sending the task. The CLI alone permits fuzzy model matching; a mismatch must fail before inference.
4. Inherit `LLAMA_BASE_URL` and `LLAMA_API_KEY` without logging their values. Use the selected native provider/model explicitly; fail rather than silently choose another model. Do not load or unload models on the router.
5. Disable child extensions and prompt templates. Retain normal Pi project instructions and skill discovery subject to Pi's trust rules. Provide a short role prompt and the delegated task, with the role's explicit built-in tool allowlist.
6. Await `agent_settled` (not just `agent_end`), close RPC input, and await successful process exit. Child progress can update the tool UI, but must not inject messages that trigger parent inference.
7. Return the final child report as the tool result. Keep child intermediate conversation out of the parent model context. Release the busy guard only after cleanup.

The normal review sequence is explicit:

```text
Parent -> Worker -> Parent -> Reviewer -> Parent
```

Each arrow into a child creates a new conversation. There is no automatic review loop. File changes are immediately visible in the shared working directory and remain after the child exits.

## Lifecycle, failures, and output

- V1 supports Linux with readable `/proc` and Node-installed Pi only; fail before launch elsewhere. Pi’s detached bash groups require descendant identity tracking in addition to the Pi process group.
- Cancellation and session shutdown must stop the child and its active tool subprocesses, escalate termination if necessary, and wait for termination before allowing another launch. Do not rely on a signal having been sent as proof of process exit.
- Remove abort listeners, timers, and any temporary prompt resources on every exit path.
- Report launch failures, invalid/missing completion output, process failures, model errors, and cancellation explicitly. Do not treat earlier progress text as a successful final report.
- Do not silently retry a delegated task or switch execution modes after a launch/setup failure. Preserve any partial file changes and report that they may exist; no automatic rollback.
- Bound progress, error diagnostics, and model-visible final output using Pi's truncation helpers. Use at most Pi's standard 50 KiB/2,000-line output limit, indicate truncation, and provide a file reference for full oversized reports. Stream parsing must not accumulate the entire child transcript in memory.
- Use ordinary Pi tool rendering/progress rather than a custom dashboard. No polling tool or background completion notifications are needed.

## Trust and guarantee boundaries

This is context isolation, not a sandbox. Workers have the user's filesystem and shell privileges. Reviewer tool restrictions do not constitute filesystem access isolation.

Child extensions are disabled to prevent recursive delegation tools and background extension activity. Consequently, parent permission/sandbox extensions and custom extension tools are not inherited. This limitation must be prominent in the README; do not claim equivalent parent/child permission enforcement or silently bypass an explicit security restriction.

Respect the parent's project trust decision when starting the child; do not elevate trust merely to load project instructions or skills. Global instructions and discovered skills can still affect child behavior. No parent conversation or extension-modified runtime prompt is implicitly inherited.

Serialization applies to calls through this extension within one Pi session. It is not an endpoint-wide lock: unrelated Pi processes, other extensions, external clients, or deliberately launched agents through a shell are outside its guarantee. Use this tool instead of an asynchronous subagent tool for the serial workflow.

## Validation

Use the smallest runnable test setup built on Node's test/assert facilities, with deterministic child-process fixtures and no required llama.cpp service for routine checks.

Cover:

- Package resources and Janitor frontmatter are discoverable.
- Unknown roles and blank tasks cannot launch children.
- Worker and reviewer receive the correct actual tool allowlists.
- Launch arguments/environment select the parent's model, thinking level, and cwd without inherited session history or enabled extensions.
- The call stays pending until child exit; sequential execution is declared, and unexpected overlap is rejected.
- Final-report extraction, split JSON output, truncation, malformed/missing completion, process errors, and model errors.
- Cancellation and shutdown terminate running child work, including escalation, and a later invocation can run without stale state.
- Janitor guidance is exercised against representative cleanup scenarios, especially preserving meaningful tests and unrelated changes.

Perform a real-Pi smoke test with native llama.cpp when an endpoint is available: delegate a small worker task and a read-only review, verify that the parent issues no model requests while the child runs, and exercise cancellation. Report live tests as not run if the endpoint is unavailable; fixture tests alone do not prove llama.cpp handoff behavior.

## Deliberate exclusions

No parallel/background mode, endpoint-wide scheduler, task queue, named-agent configuration, automatic review/fix loops, worktree management, persistent child sessions, resume support, custom provider implementation, or KV-cache management.

## References

- [Pi packages](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md)
- [Pi extensions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)
- [Pi llama.cpp provider](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/llama-cpp.md)
- [Pi subagent example](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/examples/extensions/subagent)
- [Universal Janitor source](https://github.com/github/awesome-copilot/blob/main/agents/janitor.agent.md)

## Implementation rulings (2026-09-19)

Approved during Task 2: Linux-only cancellation support because Pi bash uses detached groups; unsupported platforms fail before launch. Native RPC replaces JSON/print solely to verify exact model/provider/thinking before inference (Pi CLI has fuzzy matching). No scheduling or SDK-session architecture was added.
