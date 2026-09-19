import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { setTimeout as delay } from "node:timers/promises";
import {
  DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateHead, truncateTail,
  type ExtensionContext, type RpcCommand, type RpcResponse, type JsonAgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import type { AssistantMessage } from "@earendil-works/pi-ai";

export interface ChildOptions {
  command: string;
  args: string[];
  cwd: string;
  // RPC verifies identity before sending the prepared task, never via argv.
  prompt: string;
  expected: { provider: string; model: string; thinkingLevel: NonNullable<ExtensionContext["thinkingLevel"]> };
  signal?: AbortSignal;
  onProgress?: (text: string) => void;
  onUsage?: (usage: ChildUsage) => void;
}
export interface ChildUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  contextTokens: number;
  turns: number;
}
export interface ChildReport { text: string; reportPath?: string; usage?: ChildUsage }

const MAX_RECORD_BYTES = 8 * 1024 * 1024;
const TERMINATION_GRACE_MS = 500;
const STARTUP_TIMEOUT_MS = 30_000;

interface ProcessIdentity { pid: number; parent: number; group: number; start: string; state: string }
function processIdentity(pid: number): ProcessIdentity | undefined {
  try {
    const raw = readFileSync(`/proc/${pid}/stat`, "utf8");
    const fields = raw.slice(raw.lastIndexOf(")") + 2).split(" ");
    return { pid, state: fields[0], parent: Number(fields[1]), group: Number(fields[2]), start: fields[19] };
  } catch (error) {
    if (["ENOENT", "ESRCH"].includes((error as NodeJS.ErrnoException).code ?? "")) return undefined;
    throw error;
  }
}
function stillLive(identity: ProcessIdentity) {
  const current = processIdentity(identity.pid);
  return current?.start === identity.start && current.state !== "Z" && current.state !== "X";
}
// Pi's bash tools use their own detached groups. Snapshot descendants before
// SIGTERM reparents them; retain start times so escalation cannot target reused PIDs.
function discoverDescendants(owned: Map<number, ProcessIdentity>) {
  const processes = readdirSync("/proc").filter(name => /^\d+$/.test(name)).map(name => processIdentity(Number(name))).filter(p => p !== undefined);
  let changed = true;
  while (changed) {
    changed = false;
    for (const child of processes) {
      const parent = owned.get(child.parent);
      if (!owned.has(child.pid) && parent && stillLive(parent)) {
        owned.set(child.pid, child);
        changed = true;
      }
    }
  }
}
function signalOwned(identity: ProcessIdentity, signal: NodeJS.Signals, group = false) {
  if (!stillLive(identity)) return;
  try { process.kill(group ? -identity.group : identity.pid, signal); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
}

function redactor() {
  const secrets = Object.entries(process.env)
    .filter(([name, value]) => value && (/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(name) || name === "LLAMA_BASE_URL"))
    .map(([, value]) => value!).sort((a, b) => b.length - a.length);
  return (text: string) => {
    for (const secret of secrets) text = text.replaceAll(secret, "[redacted]");
    return text;
  };
}
function saveReport(text: string, usage?: ChildUsage): ChildReport {
  if (!truncateHead(text).truncated) return { text, usage };
  const dir = mkdtempSync(join(tmpdir(), "pi-toolkit-report-"));
  const reportPath = join(dir, "report.txt");
  try { writeFileSync(reportPath, text, { mode: 0o600 }); }
  catch (error) { rmSync(dir, { recursive: true, force: true }); throw error; }
  const suffix = `\n\n[Output truncated. Full report: ${reportPath}]`;
  const preview = truncateHead(text, { maxBytes: DEFAULT_MAX_BYTES - Buffer.byteLength(suffix), maxLines: DEFAULT_MAX_LINES - 3 });
  return { text: preview.content + suffix, reportPath, usage };
}

export async function runChild(options: ChildOptions): Promise<ChildReport> {
  if (process.platform !== "linux") throw new Error("serial_subagent requires Linux /proc for child lifecycle cleanup");
  if (options.signal?.aborted) throw new Error("Child cancelled before launch");
  // Fail before launch if the process identity facility is unavailable.
  if (!processIdentity(process.pid)) throw new Error("Linux /proc is unavailable");
  const redact = redactor();
  const proc = spawn(options.command, options.args, { cwd: options.cwd, env: process.env, shell: false, detached: true, stdio: ["pipe", "pipe", "pipe"] });
  const owned = new Map<number, ProcessIdentity>();
  const root = proc.pid ? processIdentity(proc.pid) : undefined;
  if (root) owned.set(root.pid, root);
  let failure: string | undefined;
  let stopping: Promise<void> | undefined;
  let stderr = "";
  let pending = "";
  const decoder = new StringDecoder("utf8");
  const stderrDecoder = new StringDecoder("utf8");
  const lifecycle: { phase: "state" | "prompt" | "running" | "settled" } = { phase: "state" };
  let final: AssistantMessage | undefined;
  let ended = false;
  let usage: ChildUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 };
  let startupTimer: NodeJS.Timeout | undefined;
  let exitTimer: NodeJS.Timeout | undefined;

  const stop = () => {
    if (stopping) return;
    stopping = (async () => {
      discoverDescendants(owned);
      // Give native Pi shutdown first opportunity to kill its detached bash work.
      if (root) signalOwned(root, "SIGTERM", true);
      const deadline = Date.now() + TERMINATION_GRACE_MS;
      while ([...owned.values()].some(stillLive)) {
        discoverDescendants(owned);
        if (Date.now() >= deadline) {
          for (const identity of owned.values()) {
            // Group leaders are owned; never signal a parent's/shared group.
            signalOwned(identity, "SIGKILL", identity.group === identity.pid);
          }
        }
        await delay(20);
      }
    })();
    // Preserve cleanup failures until finally awaits them, without unhandled rejection.
    void stopping.catch(() => {});
  };
  const fail = (message: string) => { failure ??= message; stop(); };
  const abort = () => fail("Child cancelled; partial file changes may remain");
  const send = (command: RpcCommand) => proc.stdin.write(JSON.stringify(command) + "\n");
  const readAssistant = (message: AssistantMessage) => {
    if (!Array.isArray(message.content) || typeof message.stopReason !== "string" || message.content.some(part => !part || typeof part.type !== "string" || (part.type === "text" && typeof part.text !== "string"))) throw new Error("Invalid assistant completion protocol");
    if (message.provider !== options.expected.provider || message.model !== options.expected.model) throw new Error("Child model identity changed");
    if (message.stopReason === "error" || message.stopReason === "aborted") throw new Error(`Child model ${message.stopReason}`);
    final = message;
    const msgUsage = message.usage;
    if (msgUsage) {
      usage.input += msgUsage.input || 0;
      usage.output += msgUsage.output || 0;
      usage.cacheRead += msgUsage.cacheRead || 0;
      usage.cacheWrite += msgUsage.cacheWrite || 0;
      usage.cost += msgUsage.cost?.total || 0;
      usage.contextTokens = msgUsage.totalTokens || 0;
      usage.turns++;
      options.onUsage?.(usage);
    }
  };
  const handle = (line: string) => {
    if (!line.trim() || failure) return;
    let event: RpcResponse | JsonAgentSessionEvent;
    try { event = JSON.parse(line); } catch { throw new Error("Malformed child JSON protocol record"); }
    if (!event || typeof event !== "object" || typeof event.type !== "string") throw new Error("Invalid child protocol record");
    if (event.type === "response") {
      if (!event.success) throw new Error("Child RPC command failed (diagnostic content withheld)");
      if (event.id === "identity" && event.command === "get_state" && lifecycle.phase === "state") {
        const state = event.data;
        if (state?.model?.provider !== options.expected.provider || state.model.id !== options.expected.model || state.thinkingLevel !== options.expected.thinkingLevel) throw new Error("Child model/thinking identity mismatch; task not sent");
        if (state.sessionFile || state.messageCount !== 0 || state.pendingMessageCount !== 0 || state.isStreaming !== false || state.isCompacting !== false) throw new Error("Child session is not fresh and idle; task not sent");
        lifecycle.phase = "prompt";
        send({ type: "prompt", id: "task", message: options.prompt });
      } else if (event.id === "task" && event.command === "prompt" && lifecycle.phase === "prompt") {
        lifecycle.phase = "running";
        clearTimeout(startupTimer);
      } else throw new Error("Unexpected child RPC response");
    } else if (event.type === "message_end" && event.message?.role === "assistant") {
      readAssistant(event.message);
    } else if (event.type === "agent_start") {
      ended = false;
      final = undefined;
    } else if (event.type === "agent_end") {
      if (!Array.isArray(event.messages)) throw new Error("Invalid agent completion protocol");
      const last = event.messages.at(-1);
      if (last?.role !== "assistant") throw new Error("Missing final assistant report");
      readAssistant(last);
      ended = true;
    } else if (event.type === "agent_settled") {
      if (lifecycle.phase !== "running" || !ended || !final || final.stopReason !== "stop" || final.content.some(part => part.type === "toolCall")) throw new Error("Missing or invalid final completion report");
      lifecycle.phase = "settled";
      proc.stdin.end(); // Native RPC EOF disposes runtime and exits with status 0.
      exitTimer = setTimeout(() => fail("Child did not exit after completion"), 5000);
    } else if (event.type === "message_update" || event.type === "tool_execution_start") {
      options.onProgress?.("Child working; waiting for final report and process exit.");
    }
  };
  const stdoutData = (chunk: Buffer) => {
    if (failure) return;
    try {
      pending += decoder.write(chunk);
      let newline: number;
      while ((newline = pending.indexOf("\n")) !== -1) {
        const line = pending.slice(0, newline);
        if (Buffer.byteLength(line) > MAX_RECORD_BYTES) throw new Error("Child protocol record exceeds 8 MiB limit");
        pending = pending.slice(newline + 1);
        handle(line);
      }
      if (Buffer.byteLength(pending) > MAX_RECORD_BYTES) throw new Error("Child protocol record exceeds 8 MiB limit");
    } catch (error) { pending = ""; fail((error as Error).message); }
  };
  const stderrData = (chunk: Buffer) => {
    stderr = truncateTail(stderr + stderrDecoder.write(chunk), { maxBytes: 4096, maxLines: 40 }).content;
  };
  const stdoutEnd = () => {
    if (failure) return;
    try { pending += decoder.end(); if (pending.trim()) handle(pending); pending = ""; }
    catch (error) { fail((error as Error).message); }
  };
  const stdinError = () => fail("Child RPC input closed unexpectedly");
  proc.stdout.on("data", stdoutData);
  proc.stdout.on("end", stdoutEnd);
  proc.stderr.on("data", stderrData);
  proc.stdin.on("error", stdinError);
  options.signal?.addEventListener("abort", abort, { once: true });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => {
    proc.once("error", () => { failure ??= "Child launch/spawn failed"; });
    proc.once("close", (code, signal) => resolve({ code, signal }));
  });
  try {
    startupTimer = setTimeout(() => fail("Child RPC startup timed out"), STARTUP_TIMEOUT_MS);
    if (options.signal?.aborted) abort();
    else send({ type: "get_state", id: "identity" });
    const status = await exited;
    await stopping;
    if (failure) throw new Error(failure);
    if (status.code !== 0 || status.signal) throw new Error(`Child exit ${status.code ?? "signal"}${status.signal ? ` (${status.signal})` : ""}${stderr ? `\n${redact(stderr)}` : ""}`);
    if (lifecycle.phase !== "settled" || !final) throw new Error("Child exited without final completion");
    const text = final.content.filter(part => part.type === "text").map(part => part.text).join("\n");
    if (!text.trim()) throw new Error("Child final report is empty");
    return saveReport(redact(text), usage);
  } catch (error) {
    throw new Error(`${redact((error as Error).message)}\nPartial file changes may remain; no rollback or retry was performed.`);
  } finally {
    clearTimeout(startupTimer);
    clearTimeout(exitTimer);
    options.signal?.removeEventListener("abort", abort);
    proc.stdout.off("data", stdoutData);
    proc.stdout.off("end", stdoutEnd);
    proc.stderr.off("data", stderrData);
    proc.stdin.off("error", stdinError);
  }
}
