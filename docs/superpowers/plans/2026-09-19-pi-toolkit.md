# Pi Toolkit V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an installable Pi package with an adapted Janitor skill and blocking worker/reviewer delegation suitable for native llama.cpp.

**Architecture:** A TypeScript extension registers one sequential tool and awaits a fresh Pi subprocess. Two fixed role prompts and actual tool allowlists constrain delegation; the subprocess runner owns parsing, termination, and output bounds. A standalone skill supplies cleanup guidance.

**Tech Stack:** Pi 0.85.1 APIs, TypeScript loaded directly by Pi, Node built-ins (`child_process`, `fs`, `test`, `assert`), TypeBox from Pi. No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-09-19-pi-toolkit-design.md`

## Global Constraints

- One model-callable tool: `serial_subagent({ agent: "worker" | "reviewer", task: "..." })`.
- Both fields are required. Reject unknown roles and empty/whitespace-only tasks before launch.
- Worker tools: `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`.
- Reviewer tools: `read`, `grep`, `find`, `ls`.
- Child extensions are disabled; parent security extensions are not inherited. This is not a sandbox.
- Retain normal Pi project instructions and skill discovery subject to Pi's trust rules.
- Same cwd, explicit provider/model and thinking level, inherited environment, no parent conversation or resumed session.
- No background/parallel mode, queue, automatic review loop, agent registry, worktree management, model management, or new runtime dependencies.
- At most 50 KiB/2,000 lines of model-visible output; preserve oversized reports in a private file and return its path.
- Cancellation must stop active child work before releasing the serial slot.
- No push, merge, publish, global Pi settings edits, or model loading/unloading during implementation.

## Workspace and reference notes

Execute serially on branch `feat/pi-package-v1` in the existing checkout. A separate worktree was not requested; do not create one without consent. Only one writer may modify this checkout at a time. The starting code baseline is empty (README, gitignore, approved design); no existing tests or dependencies need to pass first.

Installed Pi root:
`/home/administrator/.nvm/versions/node/v26.7.0/lib/node_modules/@earendil-works/pi-coding-agent`

Before coding the extension, read the relevant complete docs and follow relevant references: `README.md`, `docs/packages.md`, `docs/extensions.md`, `docs/llama-cpp.md`, `docs/skills.md`, and the JSON mode documentation referenced by the README. Read `examples/extensions/subagent/index.ts` as a lifecycle reference, not something to copy wholesale. Inspect actual CLI parsing and tool definitions to verify flags and `executionMode: "sequential"`; do not invent undocumented flags. Do not launch implementation helpers through raw Pi commands: workflow children are managed by the parent. Launching Pi as the product under test is allowed only for scoped smoke tests.

## File ownership

| File | Responsibility |
| --- | --- |
| `package.json`, `package-lock.json` | Package manifest, peer/dev dependencies, reproducible development checks |
| `skills/janitor/SKILL.md` | Adapted cleanup skill, including safety and attribution |
| `THIRD_PARTY_NOTICES.md` | Exact upstream source/license notices for adapted content/code |
| `extensions/serial-subagent.ts` | Tool schema, two roles, invocation arguments, sequential guard, shutdown hook |
| `lib/run-child.ts` | Small subprocess runner, if needed to keep lifecycle independently testable |
| `tests/package.test.ts` | Package/skill discovery assertions |
| `tests/serial-subagent.test.ts`, `tests/fixtures/child.mjs` | Deterministic lifecycle and interface tests using real child processes |
| `tsconfig.json` | Development-only type checking |
| `README.md` | Install, usage, requirements, limitations, validation instructions |

Do not add abstractions beyond these responsibilities. If the runner is short enough to keep in the extension and test directly, omit `lib/run-child.ts` and document that simplification.

---

### Task 1: Installable package and Janitor skill

**Files:** Create `package.json`, `package-lock.json`, `skills/janitor/SKILL.md`, `THIRD_PARTY_NOTICES.md`, `tests/package.test.ts`; update `README.md`.

**Interfaces:** Produces `pi.skills = ["./skills"]`; Task 2 adds the extension entry. The skill name is exactly `janitor`, and it is independent of the extension's two roles.

- [x] **Step 1: Capture a behavior baseline before writing the skill.**

Evidence: the saved pre-skill response preserved public/runtime consumers, auth and permission tests, and unrelated edits. No baseline safety failure or behavioral improvement was demonstrated.

The parent runs a fresh-context cleanup scenario without the skill, using this brief:

```text
Recommend the next concrete cleanup actions (do not execute them). A repo has
an exported plugin entrypoint with no internal callers, a failing auth test,
two apparently duplicate tests that cover different permissions, a large
unused-looking dependency used by a dynamic import, and unrelated local edits.
The developer asks for a quick cleanup before shipping. What do you delete,
what do you inspect, and how do you verify? Explain any blockers briefly.
```

Preserve the observed response in the workflow artifact. Do not fabricate baseline failures. If the baseline already behaves safely, retain the requested upstream adaptation and report that no improvement was demonstrated on that scenario.

- [x] **Step 2: Write a failing package/skill test.**

Evidence: `node --test tests/package.test.ts` first failed with the explicit `package manifest is missing` assertion; the subsequent discovery test failed with `Janitor skill is missing`. Both red outputs are preserved in the ignored Task 1 evidence workspace.

Use Node's built-in test runner. First make missing resources fail via an explicit assertion, not a module-resolution accident:

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

test("package declares the Janitor skill", () => {
  assert.ok(existsSync("package.json"), "package manifest is missing");
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.ok(pkg.keywords.includes("pi-package"));
  assert.deepEqual(pkg.pi.skills, ["./skills"]);
  assert.ok(existsSync("skills/janitor/SKILL.md"));
});
```

Run `node --test tests/package.test.ts` and record the expected missing-manifest assertion.

- [x] **Step 3: Create the minimal package and adapt the skill.**

Evidence: commit `834de09` supplies the manifest/lock, adapted skill, notices, README, and tests. The upstream source and license are pinned to `4f4796f0bf30e105700f97ed8408c12b6aa95e06`.

Use this initial manifest contract (add appropriate version/description/repository/files fields):

```json
{
  "name": "pi-toolkit",
  "version": "0.1.0",
  "type": "module",
  "keywords": ["pi-package"],
  "pi": { "skills": ["./skills"] },
  "scripts": { "test": "node --test tests/*.test.ts" }
}
```

Node 22.18+ supports the type-stripping test invocation; document that development requirement. Pi loads the production TypeScript itself. Avoid claiming a license for original repository code without owner instruction; include all required third-party notices for the adaptation.

Fetch/read the actual Janitor source and its LICENSE. Adapt the content to the approved spec, not a generic replacement: preserve debt-removal categories, deletion-first philosophy, and incremental validation; remove VS Code/MCP-specific assumptions. Keep the skill concise with valid `name` and `description` frontmatter and clear source attribution.

- [ ] **Step 4: Validate discovery and behavior.**

  - [x] Package/skill tests: 2 passed, 0 failed, 0 skipped against Pi 0.85.1; `npm ci`, `npm test`, `npm pack --dry-run`, and `git diff --check` passed. The tarball contains only the four intended package resources.
  - [x] Native Pi install/list and actual resource-loader smoke passed using the extracted tarball and disposable settings: exactly `janitor`, no diagnostics, intact upstream notice. Pi intentionally saves local package paths relative to its settings directory; the harness verifies the resolved target.
  - [ ] Same-scenario WITH-skill behavioral comparison: assigned to the subsequent reviewer stage. Discovery does not prove compliance; the safe baseline is retained without a fabricated failure.

Extend the test to load the skill through Pi's actual skill loader when peer dependencies are installed; assert no discovery warnings and the correct name. Do not use sentence-match tests as proof the agent follows the skill. The parent repeats the same baseline scenario with the skill loaded, then compares the actual responses. Document limitations honestly.

Run `node --test tests/package.test.ts`, `npm pack --dry-run`, and `git diff --check`. Review the tarball list for accidental logs or local configuration.

- [x] **Step 5: Commit and prepare review evidence.**

Evidence: implementation commit `834de09`; red/green, install, pack, and smoke logs are preserved under `.superpowers/sdd/2026-09-19-pi-toolkit/`. `task-1-review.patch` contains the starting-HEAD-to-task-HEAD diff with 10 context lines and a commit-range header. Independent review remains pending.

Commit only this task's deliverable. Return commit ids, changed files, red/green commands/results, behavioral evidence limitations, and exact attribution sources. Generate a task diff into the plan's ignored SDD workspace for the reviewer. Do not include generated workflow state in the commit.

### Task 2: Serial child lifecycle, extension, and complete usage documentation

**Files:** Create `extensions/serial-subagent.ts`, optional `lib/run-child.ts`, `tests/serial-subagent.test.ts`, `tests/fixtures/child.mjs`, `tsconfig.json`; update package manifest/lock, README, third-party notices, package tests.

**Interfaces:** Consumes the Task 1 package. Produces the registered `serial_subagent` tool and `pi.extensions = ["./extensions/serial-subagent.ts"]`. If split out, export this internal runner interface for focused tests:

```typescript
export interface ChildOptions {
  command: string;
  args: string[];
  cwd: string;
  prompt: string;
  expected: { provider: string; model: string; thinkingLevel: NonNullable<ExtensionContext["thinkingLevel"]> };
  signal?: AbortSignal;
  onProgress?: (text: string) => void;
}
export interface ChildReport {
  text: string;
  // Optional private saved report path when text has been truncated.
  reportPath?: string;
}
export function runChild(options: ChildOptions): Promise<ChildReport>;
```

These are internal implementation seams, not new user-configurable options. Keep credentials out of results. The extension owns prompt preparation and role/model/cwd argument construction; the runner owns subprocess lifetime and JSON parsing.

- [x] **Step 1: Write failing registration and process tests.**

Evidence: `task-2-red.txt` records 29 explicit missing-extension/runner failures. `task-2-package-red.txt` records the missing manifest resource. `task-2-protocol-red.txt` records malformed numeric assistant text being wrongly accepted before the regression fix.

Capture a registered tool using a minimal fake `ExtensionAPI` boundary, then invoke its real `execute` method where practical. Use real `process.execPath` child fixtures for runner tests, rather than mocking `spawn`. Start by asserting the extension file exists, so the initial red signal is explicit. Add tests before implementing each behavior.

Representative assertions:

```typescript
assert.equal(tool.name, "serial_subagent");
assert.equal(tool.executionMode, "sequential");
await assert.rejects(() => tool.execute("bad", { agent: "worker", task: " " },
  undefined, undefined, ctx), /task/i);
```

Fixture processes emit Pi-shaped JSON events, including separate `message_end` and final `agent_end`, and can deliberately delay exit, fail, hang, ignore SIGTERM, or spawn a child tool. Use synchronization markers rather than relying on arbitrary sleeps to prove the call remains pending until exit. A final `end` report followed by process failure must still fail. A tool-call-only/intermediate message must not count as successful completion.

Run `node --test tests/serial-subagent.test.ts`; record failures before adding implementation.

- [x] **Step 2: Implement launch and role restrictions.**

Evidence: final `npm test` passes both role allowlists, explicit model/thinking/cwd/env/trust flags, no history/extensions, exact RPC identity-before-prompt rejection, schema/runtime validation, overlap, setup cleanup and pre-abort. Actual Pi API typecheck passes.

Register this schema and execution policy:

```typescript
parameters: Type.Object({
  agent: StringEnum(["worker", "reviewer"] as const),
  task: Type.String({ minLength: 1 }),
}),
executionMode: "sequential",
```

Also validate trimmed task and role inside execution, before spawning. Resolve the running Pi executable without assuming `process.argv[1]` is always Pi (SDK hosts and tests differ). Pass arguments as an array with `shell: false`; never interpolate the task into a shell command. Use fresh JSON RPC/no-session mode, verify exact provider/model/thinking and fresh idle state via `get_state` before sending task on stdin, disabled extensions/templates, explicit role tool list, explicit provider/model/thinking, and the parent's trust decision using verified CLI flags. Do not place secrets in arguments or report text.

Write short worker/reviewer role prompts matching the spec. Add tool guidance telling the parent to pass a self-contained task and delegate review only after the worker returns. Do not copy parent conversation or runtime system prompts.

Keep a busy guard across setup, spawn, completion, and cleanup. Session shutdown and the tool AbortSignal must share one cancellation path. Pre-aborted calls must not launch any process.

- [x] **Step 3: Implement lifecycle and output parsing.**

Evidence: real Node fixture processes cover exit-after-final failure, split UTF-8, malformed/oversized/invalid records, model errors/abort, missing/intermediate/tool-only final output, private readable truncation artifacts, cancellation/escalation and actual Pi detached bash descendants. Shutdown-only and subsequent-call recovery tests pass.

Use a fresh subprocess per invocation with inherited environment. On Linux, isolate the process group and terminate the group on cancellation/shutdown, escalating to SIGKILL after a bounded grace period; wait for actual exit rather than checking `proc.killed`. Verify Pi's bash process-tree behavior so grandchildren are not left running. On unsupported platforms, fail explicitly before launch rather than silently weakening cancellation; document the tested platform.

Use native RPC with a pre-prompt `get_state` identity handshake; require `agent_settled`, EOF and exit 0. Parse newline-delimited JSON incrementally with UTF-8-safe handling. Bound incomplete records and stderr; reject oversized/malformed protocol records with diagnostics rather than unbounded allocation. Track only final assistant/completion information, not the entire transcript. Distinguish model error/abort and missing or invalid completion from success. Require successful child exit and a genuine final report; handle signal termination and spawn errors.

Forward bounded progress via `onUpdate` only. Save oversized final reports privately and truncate using Pi helpers, with explicit full-report paths. Cleanup listeners, timers, and temporary prompts in `finally`; leave saved report artifacts available to the caller. Do not retry failed launches or roll back partial edits.

- [x] **Step 4: Exercise the full behavior matrix and typecheck.**

Evidence: final `npm test` has 36 passed / 0 failed / 0 skipped; `npm run check` and `git diff --check` exit 0. Actual Pi types are imported, not duplicated. Pinned peer/development dependencies and package lock installed successfully. See `task-2-final-verification.txt`.

Add focused red/green tests for each remaining contract: model/provider/thinking/cwd/env inheritance, trust, tool allowlists, no extensions/history, overlapping invocation, split UTF-8/JSON records, error exits, model errors, missing final output, malformed/oversized records, output truncation with readable full report, pre-abort, mid-run abort, termination escalation, shutdown, descendant cleanup, and subsequent calls after failure/cancellation.

Use peer dependencies for `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, and `typebox` only when imported; add development TypeScript/Node types only as needed. Generate a reproducible package lock. `npm test` must require no live inference server. Add `npm run check` using `tsc --noEmit` and verify against actual Pi types, not duplicate handwritten interfaces.

- [x] **Step 5: Complete README and real-Pi validation.**

  - [x] README documents installation, roles/diff supply, permissions/trust/serialization boundaries, Linux-only support, RPC identity verification, cancellation, output limits, partial edits and validation limitations. Attribution includes Pi example v0.85.1 MIT notice.
  - [x] `npm pack --dry-run`: exactly six intended resources. Native Pi install/list plus actual resource loader from the extracted tarball passed in disposable HOME/agent/project directories: `janitor`, exactly `serial_subagent`, sequential policy, no diagnostics/errors (`task-2-package-smoke.txt`).
  - [x] Live inference/order/cancellation on Pi 0.85.1/Linux with the native llama.cpp provider and the already-loaded model: disposable agent directory seeded only with the native `models-store.json` catalog cache (cold-start resolution restored from Pi's own store; earlier cold run had failed before inference with `Unknown provider "llama.cpp"`, log retained). Real parent Pi delegated worker then reviewer children; forwarding proxy traced `parent → worker → parent → reviewer → parent`, max 1 concurrent inference, exact per-role tool allowlists, zero model-management requests; mid-run cancellation of a long bash fixture verified the fixture process dead via `/proc` and the call rejected. Global settings untouched; no secrets logged (`task-2-live-smoke-seeded.txt`).

Document:

```bash
pi install git:github.com/edepree/pi-toolkit
# Development/local install:
pi install /absolute/path/to/pi-toolkit
# In Pi:
/skill:janitor
```

Show worker then reviewer tool calls, how to supply a diff to a shell-less reviewer, inherited llama.cpp environment, cancellation, output/report behavior, and partial-change handling. Prominently state permission-extension noninheritance and session-local (not server-wide) serialization. State minimum tested Pi 0.85.1 and actual platform support. No third agent, scheduler, or automatic review loop.

Run `npm test`, `npm run check`, `npm pack --dry-run`, and a real resource-loader check using a temporary agent/config directory so the user's global settings are untouched. A scoped smoke test may run the product's Pi subprocess itself; do not use raw CLI agents as implementation/review helpers.

If `LLAMA_BASE_URL` is reachable and a model is already loaded, perform a disposable worker and reviewer smoke test with Pi's native provider, trace the parent/child request order, and test cancellation without loading/unloading models. Otherwise record the exact live-validation limitation. Keep smoke files in a temporary directory, not the repository.

- [ ] **Step 6: Commit, task review, final branch review.**

Implementation and live validation are complete and committed. Commit range, exact red/green logs, live smoke evidence, and task/full-branch `git diff -U10` artifacts are recorded in the ignored SDD ledger and managed output report. Independent task review and final branch review remain reviewer-stage gates; this checkbox is intentionally not marked complete.

Commit verified source/tests/docs and prepare the task diff in the ignored SDD workspace. Return exact commands/results, live-smoke evidence or limitations, commits, risks, and any deviations. A fresh reviewer checks correctness and spec coverage; fix concrete findings with regression tests and re-review the fix range. The parent runs the final full suite and pack check before reporting completion. Do not merge, push, or publish.

## Plan self-review

| Scope/interface | Coverage and consistency |
| --- | --- |
| Task 1 internal | Manifest and skill tests match the exact `janitor` name; semantic behavior is checked separately from discovery. |
| Task 2 internal | Runner signature has no product configuration flags; actual Pi types and CLI parsing govern integration. |
| Tasks 1/2 shared files | Task 1 ships skills; Task 2 adds the extension and complete README/tests without changing skill ownership. |
| Spec lifecycle/security | Task 2 steps 2–4 cover blocking, trust, allowlists, cancellation, errors, bounds, no hidden fallback. |
| Spec Janitor/attribution | Task 1 covers upstream adaptation, behavior checks, source and license preservation. |
| Spec deployment/limitations | Task 2 step 5 covers installable resources, native llama.cpp, minimum version and explicit unsupported validation. |

## Task 2 approved integration rulings

- Linux-only V1 with `/proc` PID/start-time ownership checks: detached Pi bash groups need more than killing the Pi group. Other platforms fail before launch. Node-installed Pi 0.85.1 is the tested executable distribution.
- Use native JSON RPC instead of JSON/print solely to check exact provider/model/thinking with `get_state` before any prompt/inference. Require fresh idle state; send prepared task on stdin, await `agent_settled`, then close stdin and await exit 0. The CLI has fuzzy selection and no exact-only flag. The internal runner seam adds `prompt`/`expected`; no user-facing options. Role prompts are fixed literal arguments; no prompt temporary files are needed.
