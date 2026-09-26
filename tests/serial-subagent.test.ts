import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";

const fixture = resolve("tests/fixtures/child.mjs");
const expected = { provider: "fixture", model: "exact-model", thinkingLevel: "off" as const };
const options = (mode: string, cwd: string, extra = {}) => ({ command: process.execPath, args: [fixture, mode], cwd, prompt: "Task: scoped task", expected, ...extra });
function temporary(t: test.TestContext) {
  const dir = mkdtempSync(join(tmpdir(), "pi-toolkit-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
async function until(predicate: () => boolean, message: string) {
  const deadline = Date.now() + 8000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, message);
    await delay(10);
  }
}
function live(pid: number) {
  try { return readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1][0] !== "Z"; }
  catch { return false; }
}
async function runner() {
  return (await import("../lib/run-child.ts")).runChild;
}
async function registered(t: test.TestContext, mode = "success") {
  const cwd = temporary(t);
  writeFileSync(join(cwd, "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent", bin: { pi: fixture } }));
  const oldRoot = process.env.PI_PACKAGE_DIR;
  const oldMode = process.env.CHILD_MODE;
  process.env.PI_PACKAGE_DIR = cwd;
  process.env.CHILD_MODE = mode;
  t.after(() => { if (oldRoot === undefined) delete process.env.PI_PACKAGE_DIR; else process.env.PI_PACKAGE_DIR = oldRoot; if (oldMode === undefined) delete process.env.CHILD_MODE; else process.env.CHILD_MODE = oldMode; });
  let tool!: ToolDefinition;
  const handlers = new Map<string, (...args: any[]) => any>();
  const api = { registerTool: (value: ToolDefinition) => { tool = value; }, on: (event: string, handler: (...args: any[]) => any) => handlers.set(event, handler) } as unknown as ExtensionAPI;
  (await import("../extensions/serial-subagent.ts")).default(api);
  const ctx = { cwd, model: { provider: "fixture", id: "exact-model", contextWindow: 1000 }, thinkingLevel: "off", isProjectTrusted: () => false } as ExtensionContext;
  return { tool, ctx, cwd, handlers };
}

test("extension registers one sequential tool and rejects invalid calls before launch", async (t) => {
  const { tool, ctx, cwd } = await registered(t);
  assert.equal(tool.name, "serial_subagent");
  assert.equal(tool.executionMode, "sequential");
  assert.deepEqual((tool.parameters as { required?: string[] }).required, ["agent", "task"]);
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
  ["invalid-shape", /protocol|completion/i], ["prompt-failure", /prompt|RPC/i],
  ["wrong-model", /model|identity/i], ["wrong-thinking", /thinking|identity/i], ["history", /fresh|history|session/i],
] as const) {
  test(`runner rejects ${mode} and permits a subsequent call`, async (t) => {
    const runChild = await runner();
    const cwd = temporary(t);
    const notSent = ["wrong-model", "wrong-thinking", "history"].includes(mode);
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
  const old = process.env.LLAMA_API_KEY;
  process.env.LLAMA_API_KEY = "fixture-secret-do-not-return";
  t.after(() => { if (old === undefined) delete process.env.LLAMA_API_KEY; else process.env.LLAMA_API_KEY = old; });
  const updates: { usage: object; activity: string[] }[] = [];
  const report = await runChild(options("progress-secret", temporary(t), { onProgress: (p: { usage: object; activity: string[] }) => updates.push(p) }));
  const activity = updates.at(-1)!.activity;
  assert.deepEqual(activity.slice(0, 2), ["intermediate", "→ bash echo [redacted] && ls"]);
  assert.ok(activity.every(line => line.length <= 120 && !line.includes("fixture-secret-do-not-return")));
  // Two assistant messages: usage must not be double-counted from agent_end.
  assert.deepEqual(updates.at(-1)!.usage, { input: 2, output: 2, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 2, turns: 2 });
  assert.ok(!report.text.includes("fixture-secret-do-not-return"));
  await assert.rejects(runChild(options("stderr", temporary(t))), (error: Error) => {
    assert.ok(Buffer.byteLength(error.message) < 8192);
    assert.ok(!error.message.includes("fixture-secret-do-not-return"));
    assert.match(error.message, /exit.*9/i);
    return true;
  });
});

for (const mode of ["hang", "ignore-term", "detached-tool", "pi-bash"]) {
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
    const old = process.env.TOOLKIT_ENV_SENTINEL;
    process.env.TOOLKIT_ENV_SENTINEL = "inherited";
    t.after(() => { if (old === undefined) delete process.env.TOOLKIT_ENV_SENTINEL; else process.env.TOOLKIT_ENV_SENTINEL = old; });
    for (const trusted of [false, true]) {
      const result = await tool.execute("call", { agent, task }, undefined, undefined, { ...ctx, isProjectTrusted: () => trusted });
      assert.match((result.content[0] as { text: string }).text, /Final/);
      const launch = JSON.parse(readFileSync(join(cwd, "launch.json"), "utf8"));
      const args: string[] = launch.args;
      const value = (flag: string) => args[args.indexOf(flag) + 1];
      assert.equal(value("--mode"), "rpc");
      assert.equal(value("--tools"), agent === "worker" ? "read,bash,edit,write,grep,find,ls" : "read,grep,find,ls");
      assert.equal(value("--provider"), "fixture");
      assert.equal(value("--model"), "exact-model");
      assert.equal(value("--thinking"), "off");
      for (const flag of ["--no-session", "--no-extensions", "--no-prompt-templates", trusted ? "--approve" : "--no-approve"]) assert.ok(args.includes(flag));
      for (const flag of ["--session", "--continue", "--resume", "--fork", "--extension", "--no-skills", "--no-context-files", "--api-key"]) assert.ok(!args.includes(flag));
      assert.equal(launch.cwd, cwd);
      assert.equal(launch.env, "inherited");
      assert.ok(!args.includes(task));
      assert.equal(readFileSync(join(cwd, "prompt-received"), "utf8"), `Task: ${task}`);
      assert.ok(!existsSync(join(cwd, "SHOULD_NOT_EXIST")));
    }
  });
}

test("busy guard covers invocation and cleanup; abort and shutdown share cleanup", { timeout: 15000 }, async (t) => {
  const { tool, ctx, cwd, handlers } = await registered(t, "ignore-term");
  const controller = new AbortController();
  const call = () => tool.execute("call", { agent: "worker", task: "x" }, controller.signal, undefined, ctx);
  const active = assert.rejects(call(), /cancel|abort/i);
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
  await assert.rejects(call(), /exit/);
  process.env.CHILD_MODE = "hang";
  const controller = new AbortController();
  const rejected = assert.rejects(call(controller.signal), /cancel|abort/i);
  await until(() => existsSync(join(cwd, "ready")), "ready for cancellation");
  controller.abort();
  await rejected;
  process.env.CHILD_MODE = "success";
  assert.match(((await call()).content[0] as { text: string }).text, /Final/);
});

test("invalid assistant text blocks cannot become a successful report", async (t) => {
  const runChild = await runner();
  await assert.rejects(runChild(options("invalid-text", temporary(t))), /protocol|completion|text/i);
});

test("shutdown alone cancels the child and waits for termination", async (t) => {
  const { tool, ctx, cwd, handlers } = await registered(t, "detached-tool");
  const result = assert.rejects(tool.execute("call", { agent: "worker", task: "x" }, undefined, undefined, ctx), /cancel|abort/i);
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
    Object.defineProperty(process, "platform", { ...descriptor, value: "darwin" });
    await assert.rejects(runChild(options("success", cwd)), /Linux/i);
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
  process.env.PI_PACKAGE_DIR = join(cwd, "absent");
  await assert.rejects(call());
  process.env.PI_PACKAGE_DIR = cwd;
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
  assert.match(lines, /⏳ worker 1 turn/);
  assert.match(lines, /intermediate/);
  assert.doesNotMatch(lines, /✓/);
});
