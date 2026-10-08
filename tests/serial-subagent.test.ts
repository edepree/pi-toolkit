import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parseFrontmatter, type ExtensionAPI, type ExtensionToolContext, type ToolDefinition } from "@earendil-works/pi-coding-agent";

const fixture = resolve("tests/fixtures/child.mjs");
const expected = { provider: "fixture", model: "exact-model", thinkingLevel: "off" as const };
const options = (mode: string, cwd: string, extra = {}) => ({ command: process.execPath, args: [fixture, mode], cwd, prompt: "Task: scoped task", expected, ...extra });
function temporary(t: test.TestContext) {
  const dir = mkdtempSync(join(tmpdir(), "pi-toolkit-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function setEnv(t: test.TestContext, name: string, value: string) {
  const old = process.env[name];
  process.env[name] = value;
  t.after(() => { if (old === undefined) delete process.env[name]; else process.env[name] = old; });
}
async function until(predicate: () => boolean, message: string) {
  const deadline = Date.now() + 8000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, message);
    await delay(10);
  }
}
function live(pid: number) {
  try { return readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1]?.[0] !== "Z"; }
  catch { return false; }
}
// Post-launch failures return isError results (carrying usage) instead of throwing.
async function failed(result: Promise<{ content: unknown[]; isError?: boolean }>, pattern: RegExp) {
  const value = await result;
  assert.equal(value.isError, true);
  assert.match((value.content[0] as { text: string }).text, pattern);
  return value;
}
async function runner() {
  return (await import("../lib/run-child.ts")).runChild;
}
async function registered(t: test.TestContext, mode = "success") {
  const cwd = temporary(t);
  writeFileSync(join(cwd, "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent", bin: { pi: fixture } }));
  setEnv(t, "PI_PACKAGE_DIR", cwd);
  setEnv(t, "CHILD_MODE", mode);
  let tool!: ToolDefinition;
  const handlers = new Map<string, (...args: any[]) => any>();
  const api = { registerTool: (value: ToolDefinition) => { tool = value; }, on: (event: string, handler: (...args: any[]) => any) => handlers.set(event, handler) } as unknown as ExtensionAPI;
  (await import("../extensions/serial-subagent.ts")).default(api);
  const models = [
    { provider: "fixture", id: "exact-model", contextWindow: 1000 },
    { provider: "fixture", id: "coder", contextWindow: 2000, reasoning: true },
    { provider: "llama.cpp", id: "local", contextWindow: 3000 },
    { provider: "fixture", id: "no-auth", contextWindow: 1000 },
    { provider: "openrouter", id: "anthropic/x", contextWindow: 1000 },
    { provider: "router", id: "auto", api: "pi-virtual", contextWindow: 1000 },
  ];
  const modelRegistry = { find: (p: string, id: string) => models.find(m => m.provider === p && m.id === id), hasConfiguredAuth: (m: { id: string }) => m.id !== "no-auth" };
  const ctx = { cwd, model: models[0], modelRegistry, thinkingLevel: "high", isProjectTrusted: () => false } as unknown as ExtensionToolContext;
  return { tool, ctx, cwd, handlers };
}

test("extension registers one sequential tool and rejects invalid calls before launch", async (t) => {
  const { tool, ctx, cwd } = await registered(t);
  assert.equal(tool.name, "serial_subagent");
  assert.equal(tool.executionMode, "sequential");
  assert.deepEqual((tool.parameters as { required?: string[] }).required, ["agent", "task"]);
  for (const name of ["worker", "reviewer"]) {
    const { frontmatter } = parseFrontmatter<{ description: string }>(readFileSync(`agents/${name}.md`, "utf8"));
    assert.ok(tool.description.includes(`${name}: ${frontmatter.description}`));
    assert.ok(tool.promptGuidelines!.some(line => line.includes(`${name}: ${frontmatter.description}`)));
  }
  await assert.rejects(() => tool.execute("bad", { agent: "worker", task: " \n" }, undefined, undefined, ctx), /task/i);
  await assert.rejects(() => tool.execute("no-model", { agent: "worker", task: "x" }, undefined, undefined, { ...ctx, model: undefined }), /model/i);
  assert.ok(!existsSync(join(cwd, "started")));
});

test("runner accepts only final assistant report, split UTF-8 and LF records", async (t) => {
  const runChild = await runner();
  for (const mode of ["success", "split"]) {
    const result = await runChild(options(mode, temporary(t)));
    assert.equal(result.text, "Final café 🐈\u2028report\nsecond block");
    assert.ok(!result.text.includes("intermediate"));
  }
});

test("runner stays pending after agent_end and settled until actual process exit", async (t) => {
  const runChild = await runner();
  const cwd = temporary(t);
  let finished = false;
  const promise = runChild(options("wait-exit", cwd)).finally(() => { finished = true; });
  await until(() => existsSync(join(cwd, "stdin-ended")), "runner must wait for settled then close stdin");
  assert.equal(finished, false);
  writeFileSync(join(cwd, "release"), "");
  assert.match((await promise).text, /Final/);
});

for (const [mode, error] of [
  ["fail-after-final", /exit.*7/i], ["signal-exit", /signal|SIGUSR2/i],
  ["model-error", /model.*error/i], ["model-abort", /abort/i],
  ["missing", /completion|final|report/i], ["intermediate-only", /completion|final|report/i],
  ["tool-only", /completion|final|report/i], ["length", /completion|length/i],
  ["malformed", /malformed|JSON|protocol/i], ["oversized", /record.*limit|oversized/i],
  ["prompt-failure", /prompt|RPC/i],
  ["wrong-model", /model|identity/i], ["wrong-thinking", /thinking|identity/i],
  ["queued", /did not start/i], ["settled-aborted", /abort/i],
] as const) {
  test(`runner rejects ${mode} and permits a subsequent call`, async (t) => {
    const runChild = await runner();
    const cwd = temporary(t);
    const notSent = ["wrong-model", "wrong-thinking"].includes(mode);
    await assert.rejects(runChild(options(mode, cwd)), (e: Error) => error.test(e.message) && notSent !== /Partial file changes/.test(e.message));
    if (notSent) assert.ok(!existsSync(join(cwd, "prompt-received")));
    assert.match((await runChild(options("success", cwd))).text, /Final/);
  });
}

test("runner reports spawn failure and pre-aborted calls never spawn", async (t) => {
  const runChild = await runner();
  const cwd = temporary(t);
  await assert.rejects(runChild({ ...options("success", cwd), command: "/nonexistent/pi-toolkit" }), /launch|spawn/i);
  await assert.rejects(runChild(options("success", cwd, { signal: AbortSignal.abort() })), /cancel|abort/i);
  assert.ok(!existsSync(join(cwd, "started")));
});

test("oversized reports are privately saved and bounded including file reference", async (t) => {
  const runChild = await runner();
  for (const mode of ["large", "long-line"]) {
    const report = await runChild(options(mode, temporary(t)));
    assert.ok(report.reportPath);
    t.after(() => rmSync(dirname(report.reportPath!), { recursive: true, force: true }));
    assert.equal(readFileSync(report.reportPath, "utf8"), mode === "large" ? "café 🐈\n".repeat(7000) : "x".repeat(70000));
    assert.equal(statSync(report.reportPath).mode & 0o777, 0o600);
    assert.equal(statSync(dirname(report.reportPath)).mode & 0o777, 0o700);
    assert.match(report.text, /truncated/i);
    assert.ok(report.text.includes(report.reportPath));
    assert.ok(Buffer.byteLength(report.text) <= 50 * 1024);
    assert.ok(report.text.split("\n").length <= 2000);
  }
});

test("progress and stderr are bounded and credential values are not returned", async (t) => {
  const runChild = await runner();
  setEnv(t, "LLAMA_API_KEY", "fixture-secret-do-not-return");
  setEnv(t, "SHORT_KEY", "ls"); // too short to redact: "&& ls" below must survive
  const updates: { stats: { usage: { input: number; output: number }; turns: number; contextTokens: number }; activity: string[] }[] = [];
  const report = await runChild(options("progress-secret", temporary(t), { onProgress: (p: typeof updates[number]) => updates.push(p) }));
  const activity = updates.at(-1)!.activity;
  assert.deepEqual(activity.slice(0, 2), ["intermediate", "→ bash echo [redacted] && ls"]);
  assert.ok(activity.every(line => line.length <= 120 && !line.includes("fixture-secret-do-not-return")));
  // Two assistant messages; agent_end must not count usage again.
  const { stats } = updates.at(-1)!;
  assert.deepEqual([stats.usage.input, stats.usage.output, stats.turns, stats.contextTokens], [2, 2, 2, 2]);
  assert.ok(!report.text.includes("fixture-secret-do-not-return"));
  await assert.rejects(runChild(options("stderr", temporary(t))), (error: Error) => {
    assert.ok(Buffer.byteLength(error.message) < 8192);
    assert.ok(!error.message.includes("fixture-secret-do-not-return"));
    assert.match(error.message, /exit.*9/i);
    return true;
  });
});

for (const mode of ["hang", "ignore-term", "pi-bash"]) {
  test(`cancellation waits for terminated work: ${mode}`, { timeout: 15000 }, async (t) => {
    const runChild = await runner();
    const cwd = temporary(t);
    const controller = new AbortController();
    const promise = runChild(options(mode, cwd, { signal: controller.signal }));
    const rejected = assert.rejects(promise, /cancel|abort/i);
    await until(() => existsSync(join(cwd, "ready")), "child readiness");
    const pids: number[] = JSON.parse(readFileSync(join(cwd, "ready"), "utf8"));
    t.after(() => { for (const pid of pids) { try { process.kill(pid, "SIGKILL"); } catch {} } });
    controller.abort();
    await rejected;
    assert.ok(pids.every(pid => !live(pid)), `owned work still alive: ${pids.filter(live)}`);
    assert.match((await runChild(options("success", cwd))).text, /Final/);
  });
}

for (const agent of ["worker", "reviewer"]) {
  test(`${agent} receives actual allowlist, model, cwd, env, trust and fresh-session flags`, async (t) => {
    const { tool, ctx, cwd } = await registered(t);
    const task = "--provider evil; $(touch SHOULD_NOT_EXIST)\n@not-an-input-file";
    setEnv(t, "TOOLKIT_ENV_SENTINEL", "inherited");
    for (const trusted of [false, true]) {
      const result = await tool.execute("call", { agent, task }, undefined, undefined, { ...ctx, isProjectTrusted: () => trusted });
      assert.match((result.content[0] as { text: string }).text, /Final/);
      const launch = JSON.parse(readFileSync(join(cwd, "launch.json"), "utf8"));
      const args: string[] = launch.args;
      const value = (flag: string) => args[args.indexOf(flag) + 1] ?? "";
      assert.equal(value("--mode"), "rpc");
      assert.equal(value("--tools"), agent === "worker" ? "read,bash,edit,write,grep,find,ls" : "read,grep,find,ls");
      assert.match(value("--append-system-prompt"), agent === "worker" ? /^You are the worker .*do not claim rollback\.$/ : /^You are the read-only reviewer .*disclose credentials\.$/);
      assert.equal(value("--provider"), "fixture");
      assert.equal(value("--model"), "exact-model");
      assert.equal(value("--thinking"), "off"); // parent "high" clamped: exact-model has no reasoning
      for (const flag of ["--no-session", "--no-extensions", "--no-prompt-templates", trusted ? "--approve" : "--no-approve"]) assert.ok(args.includes(flag));
      for (const flag of ["--session", "--continue", "--resume", "--fork", "--extension", "-e", "--no-skills", "--no-context-files", "--api-key"]) assert.ok(!args.includes(flag));
      assert.equal(launch.cwd, cwd);
      assert.equal(launch.env, "inherited");
      assert.ok(!args.includes(task));
      assert.equal(readFileSync(join(cwd, "prompt-received"), "utf8"), `Task: ${task}`);
      assert.ok(!existsSync(join(cwd, "SHOULD_NOT_EXIST")));
    }
  });
}

test("model override picks the child model, clamps thinking and loads only the llama.cpp built-in", async (t) => {
  const { tool, ctx, cwd } = await registered(t);
  const call = async (model: string) => {
    const result = await tool.execute("call", { agent: "worker", task: "x", model }, undefined, undefined, ctx);
    const args: string[] = JSON.parse(readFileSync(join(cwd, "launch.json"), "utf8")).args;
    return { result, value: (flag: string) => args[args.indexOf(flag) + 1], args };
  };
  const coder = await call("fixture/coder");
  assert.equal(coder.value("--model"), "coder");
  assert.equal(coder.value("--thinking"), "high");
  assert.equal((coder.result.details as { model: string }).model, "fixture/coder");
  assert.ok(!coder.args.includes("-e"));
  const local = await call("llama.cpp/local");
  assert.equal(local.value("--provider"), "llama.cpp");
  assert.equal(local.value("-e"), "builtin:llama.cpp");
  assert.equal(local.args.filter(a => a === "-e").length, 1);
  assert.equal((await call("openrouter/anthropic/x")).value("--model"), "anthropic/x");
  rmSync(join(cwd, "started"));
  for (const [model, error] of [["fixture/missing", /unknown model/i], ["fixture/no-auth", /credentials/i], ["router/auto", /virtual/i], ["noslash", /provider\/id/i], ["fixture/", /provider\/id/i]] as const) {
    await assert.rejects(() => tool.execute("call", { agent: "worker", task: "x", model }, undefined, undefined, ctx), error);
  }
  assert.ok(!existsSync(join(cwd, "started")));
});

test("busy guard covers invocation and cleanup; abort and shutdown share cleanup", { timeout: 15000 }, async (t) => {
  const { tool, ctx, cwd, handlers } = await registered(t, "ignore-term");
  const controller = new AbortController();
  const call = () => tool.execute("call", { agent: "worker", task: "x" }, controller.signal, undefined, ctx);
  const active = failed(call(), /cancel|abort/i);
  await assert.rejects(call(), /busy|running/i);
  await until(() => existsSync(join(cwd, "ready")), "child ready");
  controller.abort();
  const shutdown = handlers.get("session_shutdown")!({ type: "session_shutdown", reason: "quit" }, ctx);
  await assert.rejects(call(), /busy|running|shutdown/i);
  await Promise.all([active, shutdown]);
  const pids: number[] = JSON.parse(readFileSync(join(cwd, "ready"), "utf8"));
  assert.ok(pids.every(pid => !live(pid)));
});

test("extension releases busy state after failure and cancellation", async (t) => {
  const { tool, ctx, cwd } = await registered(t, "fail-after-final");
  const call = (signal?: AbortSignal) => tool.execute("call", { agent: "reviewer", task: "x" }, signal, undefined, ctx);
  // Two fixture turns of 1 input token each; a failed run must still report them.
  assert.equal((await failed(call(), /exit/) as { usage?: { input: number } }).usage?.input, 2);
  process.env["CHILD_MODE"] = "hang";
  const controller = new AbortController();
  const rejected = failed(call(controller.signal), /cancel|abort/i);
  await until(() => existsSync(join(cwd, "ready")), "ready for cancellation");
  controller.abort();
  await rejected;
  process.env["CHILD_MODE"] = "success";
  const ok = await call();
  assert.match((ok.content[0] as { text: string }).text, /Final/);
  assert.equal((ok as { usage?: { input: number } }).usage?.input, 2);
});

test("shutdown alone cancels the child and waits for termination", async (t) => {
  const { tool, ctx, cwd, handlers } = await registered(t, "pi-bash");
  const result = failed(tool.execute("call", { agent: "worker", task: "x" }, undefined, undefined, ctx), /cancel|abort/i);
  await until(() => existsSync(join(cwd, "ready")), "child ready for shutdown");
  await handlers.get("session_shutdown")!({ type: "session_shutdown", reason: "reload" }, ctx);
  await result;
  const pids: number[] = JSON.parse(readFileSync(join(cwd, "ready"), "utf8"));
  assert.ok(pids.every(pid => !live(pid)));
});

test("unsupported platforms fail before launch", async (t) => {
  const runChild = await runner();
  const cwd = temporary(t);
  const descriptor = Object.getOwnPropertyDescriptor(process, "platform")!;
  try {
    Object.defineProperty(process, "platform", { ...descriptor, value: "win32" });
    await assert.rejects(runChild(options("success", cwd)), /Windows/i);
  } finally { Object.defineProperty(process, "platform", descriptor); }
  assert.ok(!existsSync(join(cwd, "started")));
});

test("setup failure releases guard; pre-abort leaves no abort listeners or child", async (t) => {
  const { getEventListeners } = await import("node:events");
  const { tool, ctx, cwd } = await registered(t);
  const call = (signal?: AbortSignal) => tool.execute("call", { agent: "worker", task: "x" }, signal, undefined, ctx);
  const signal = AbortSignal.abort();
  await assert.rejects(call(signal), /cancel|abort/i);
  assert.equal(getEventListeners(signal, "abort").length, 0);
  assert.ok(!existsSync(join(cwd, "started")));
  process.env["PI_PACKAGE_DIR"] = join(cwd, "absent");
  await assert.rejects(call());
  process.env["PI_PACKAGE_DIR"] = cwd;
  const controller = new AbortController();
  await call(controller.signal);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("partial updates render live activity instead of a finished checkmark", async (t) => {
  const { tool, ctx } = await registered(t, "success");
  const updates: any[] = [];
  await tool.execute("call", { agent: "worker", task: "x" }, undefined, (u: any) => updates.push(u), ctx);
  const theme = { fg: (_: string, s: string) => s, bold: (s: string) => s } as any;
  const lines = tool.renderResult!(updates[0], { expanded: false, isPartial: true }, theme, { isError: false } as any).render(200).join("\n");
  assert.match(lines, /⏳ worker fixture\/exact-model 1 turn/);
  assert.match(lines, /intermediate/);
  assert.doesNotMatch(lines, /✓/);
  const done = tool.renderResult!({ content: [], details: updates.at(-1).details }, { expanded: false, isPartial: false }, theme, { isError: false, durationMs: 1234 } as any).render(200).join("\n");
  assert.match(done, /✓ worker .*1\.2s/);
  (await import("@earendil-works/pi-coding-agent")).initTheme("dark");
  const details = { ...updates.at(-1).details, reportPath: "/tmp/report.txt" };
  const expanded = tool.renderResult!({ content: [{ type: "text", text: "Final **report**" }], details }, { expanded: true, isPartial: false }, theme, { isError: true, durationMs: 50 } as any).render(200).join("\n");
  assert.match(expanded, /✗ worker fixture\/exact-model/);
  assert.match(expanded, /Final .*report/);
  assert.match(expanded, /2 turns.*0\.1s/);
  assert.match(expanded, /Full report: \/tmp\/report\.txt/);
});

// Opt-in, spends tokens: PI_TOOLKIT_LIVE_MODEL=provider/id npm test. Checks the real Pi RPC protocol, not the fixture.
const liveModel = process.env["PI_TOOLKIT_LIVE_MODEL"] ?? "";
test("live: real Pi child completes a task over RPC", { skip: !liveModel && "set PI_TOOLKIT_LIVE_MODEL=provider/id", timeout: 120000 }, async (t) => {
  const runChild = await runner();
  const slash = liveModel.indexOf("/");
  const provider = liveModel.slice(0, slash), model = liveModel.slice(slash + 1);
  const root = resolve("node_modules/@earendil-works/pi-coding-agent");
  const cli = resolve(root, JSON.parse(readFileSync(join(root, "package.json"), "utf8")).bin.pi);
  const report = await runChild({
    command: process.execPath,
    args: [cli, "--mode", "rpc", "--no-session", "--no-extensions", "--no-prompt-templates", "--tools", "read", "--provider", provider, "--model", model, "--thinking", "off", "--no-approve"],
    cwd: temporary(t), prompt: "Reply with exactly the word OK.", expected: { provider, model, thinkingLevel: "off" },
  });
  assert.match(report.text, /OK/);
  assert.ok(report.stats.turns >= 1 && report.stats.usage.input > 0);
});
