import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { setTimeout as delay } from "node:timers/promises";
import {
  DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateHead, truncateTail,
  type ExtensionContext, type RpcCommand, type RpcResponse, type JsonAgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import type { AssistantMessage, Usage } from "@earendil-works/pi-ai";

export interface ChildOptions {
  command: string;
  args: string[];
  cwd: string;
  // Sent over RPC after the child's model is verified; never passed in argv.
  prompt: string;
  expected: { provider: string; model: string; thinkingLevel: NonNullable<ExtensionContext["thinkingLevel"]> };
  signal?: AbortSignal;
  onProgress?: (progress: ChildProgress) => void;
}
// activity: the latest redacted one-line notes (tool calls, assistant text).
export interface ChildProgress { stats: ChildStats; activity: string[] }
// usage: summed over all child turns; contextTokens: the last turn's context size.
export interface ChildStats { usage: Usage; turns: number; contextTokens: number }
export interface ChildReport { text: string; reportPath?: string; stats: ChildStats }
// Carries what the child spent before failing, so callers can still report it.
export class ChildError extends Error {
  stats: ChildStats;
  constructor(message: string, stats: ChildStats) { super(message); this.stats = stats; }
}

const MAX_RECORD_BYTES = 8 * 1024 * 1024;
const TERMINATION_GRACE_MS = 500;
const STARTUP_TIMEOUT_MS = 30_000;

function redactor() {
  const secrets = Object.entries(process.env)
    // Short values like "1" would redact ordinary output. LLAMA_BASE_URL may embed credentials (https://user:pass@host).
    .filter(([name, value]) => value && value.length >= 8 && (/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(name) || name === "LLAMA_BASE_URL"))
    .map(([, value]) => value!).sort((a, b) => b.length - a.length);
  return (text: string) => {
    for (const secret of secrets) text = text.replaceAll(secret, "[redacted]");
    return text;
  };
}
function saveReport(text: string, stats: ChildStats): ChildReport {
  if (!truncateHead(text).truncated) return { text, stats };
  const dir = mkdtempSync(join(tmpdir(), "pi-toolkit-report-"));
  const reportPath = join(dir, "report.txt");
  try { writeFileSync(reportPath, text, { mode: 0o600 }); }
  catch (error) { rmSync(dir, { recursive: true, force: true }); throw error; }
  const suffix = `\n\n[Output truncated. Full report: ${reportPath}]`;
  const preview = truncateHead(text, { maxBytes: DEFAULT_MAX_BYTES - Buffer.byteLength(suffix), maxLines: DEFAULT_MAX_LINES - 3 });
  return { text: preview.content + suffix, reportPath, stats };
}

export async function runChild(options: ChildOptions): Promise<ChildReport> {
  if (process.platform === "win32") throw new Error("serial_subagent needs POSIX process groups; Windows is unsupported");
  if (options.signal?.aborted) throw new Error("Child cancelled before launch");
  const redact = redactor();
  const proc = spawn(options.command, options.args, { cwd: options.cwd, env: process.env, shell: false, detached: true, stdio: ["pipe", "pipe", "pipe"] });
  let closed = false;
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => {
    proc.once("error", () => { failure ??= "Child launch/spawn failed"; });
    proc.once("close", (code, signal) => { closed = true; resolve({ code, signal }); });
  });
  let failure: string | undefined;
  let stopping: Promise<void> | undefined;
  let stderr = "";
  let pending = "";
  const decoder = new StringDecoder("utf8");
  const stderrDecoder = new StringDecoder("utf8");
  let phase = "state" as "state" | "prompt" | "running" | "settled";
  let final: AssistantMessage | undefined;
  let ended = false;
  const stats: ChildStats = {
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    turns: 0,
    contextTokens: 0,
  };
  let startupTimer: NodeJS.Timeout | undefined;
  let exitTimer: NodeJS.Timeout | undefined;

  const stop = () => {
    if (stopping) return;
    stopping = (async () => {
      // Pi's RPC SIGTERM handler kills the detached bash process trees it started.
      // ponytail: a child that ignores SIGTERM leaves those bash groups running; track descendants if that bites.
      signalGroup("SIGTERM");
      await Promise.race([exited, delay(TERMINATION_GRACE_MS)]);
      if (!closed) signalGroup("SIGKILL");
    })();
    // The try block awaits this later; the catch prevents an unhandled rejection before then.
    void stopping.catch(() => {});
  };
  const signalGroup = (signal: NodeJS.Signals) => {
    if (!proc.pid) return;
    try { process.kill(-proc.pid, signal); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
  };
  const fail = (message: string) => { failure ??= message; stop(); };
  const abort = () => fail("Child cancelled; partial file changes may remain");
  const send = (command: RpcCommand) => proc.stdin.write(JSON.stringify(command) + "\n");
  const readAssistant = (message: AssistantMessage) => {
    if (message.provider !== options.expected.provider || message.model !== options.expected.model) throw new Error("Child model identity changed");
    if (message.stopReason === "error" || message.stopReason === "aborted") throw new Error(`Child model ${message.stopReason}`);
    final = message;
  };
  // Count usage on message_end only; agent_end repeats the final message.
  const addUsage = ({ usage: u }: AssistantMessage) => {
    for (const key of ["input", "output", "cacheRead", "cacheWrite", "totalTokens"] as const) stats.usage[key] += u[key];
    for (const key of ["input", "output", "cacheRead", "cacheWrite", "total"] as const) stats.usage.cost[key] += u.cost[key];
    stats.contextTokens = u.totalTokens;
    stats.turns++;
  };
  const activity: string[] = [];
  const progress = (line?: string) => {
    if (line) activity.push(redact(line).replace(/\s+/g, " ").trim().slice(0, 120));
    if (activity.length > 5) activity.shift();
    options.onProgress?.({ stats: structuredClone(stats), activity: [...activity] });
  };
  const handle = (line: string) => {
    if (!line.trim() || failure) return;
    let event: RpcResponse | JsonAgentSessionEvent;
    try { event = JSON.parse(line); } catch { throw new Error("Malformed child JSON protocol record"); }
    if (event.type === "response") {
      if (!event.success) throw new Error("Child RPC command failed (diagnostic content withheld)");
      if (event.id === "identity" && event.command === "get_state" && phase === "state") {
        const state = event.data;
        if (state?.model?.provider !== options.expected.provider || state.model.id !== options.expected.model || state.thinkingLevel !== options.expected.thinkingLevel) throw new Error("Child model/thinking identity mismatch; task not sent");
        phase = "prompt";
        send({ type: "prompt", id: "task", message: options.prompt });
      } else if (event.id === "task" && event.command === "prompt" && phase === "prompt") {
        // "queued" or "handled" (e.g. consumed by an input hook) means no run will report back.
        if (event.data?.disposition !== "started") throw new Error("Child did not start the task");
        phase = "running";
        clearTimeout(startupTimer);
      } else throw new Error("Unexpected child RPC response");
    } else if (event.type === "message_end" && event.message?.role === "assistant") {
      readAssistant(event.message);
      addUsage(event.message);
      const text = event.message.content.find(part => part.type === "text" && part.text.trim());
      progress(text?.type === "text" ? text.text : undefined);
    } else if (event.type === "agent_start") {
      ended = false;
      final = undefined;
    } else if (event.type === "agent_end") {
      const last = event.messages.at(-1);
      if (last?.role !== "assistant") throw new Error("Missing final assistant report");
      readAssistant(last);
      ended = true;
    } else if (event.type === "agent_settled") {
      if (event.aborted) throw new Error("Child run aborted");
      if (phase !== "running" || !ended || !final || final.stopReason !== "stop" || final.content.some(part => part.type === "toolCall")) throw new Error("Missing or invalid final completion report");
      phase = "settled";
      proc.stdin.end(); // On stdin EOF, Pi RPC mode shuts down and exits 0.
      exitTimer = setTimeout(() => fail("Child did not exit after completion"), 5000);
    } else if (event.type === "tool_execution_start") {
      // args is untyped child output: show the first string hint, else the JSON.
      const args: unknown = event.args ?? {};
      const hint = ["command", "path", "pattern"].map(key => (args as Record<string, unknown>)[key]).find(value => typeof value === "string");
      progress(`→ ${event.toolName} ${hint ?? JSON.stringify(args)}`);
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
  try {
    startupTimer = setTimeout(() => fail("Child RPC startup timed out"), STARTUP_TIMEOUT_MS);
    send({ type: "get_state", id: "identity" });
    const status = await exited;
    await stopping;
    if (failure) throw new Error(failure);
    if (status.code !== 0 || status.signal) throw new Error(`Child exit ${status.code ?? "signal"}${status.signal ? ` (${status.signal})` : ""}${stderr ? `\n${redact(stderr)}` : ""}`);
    if (phase !== "settled" || !final) throw new Error("Child exited without final completion");
    const text = final.content.filter(part => part.type === "text").map(part => part.text).join("\n");
    if (!text.trim()) throw new Error("Child final report is empty");
    return saveReport(redact(text), stats);
  } catch (error) {
    const note = phase === "state" ? "" : "\nPartial file changes may remain; no rollback or retry was performed.";
    throw new ChildError(redact((error as Error).message) + note, stats);
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
