import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { createInterface } from "node:readline";

const mode = process.env.CHILD_MODE || process.argv[2];
writeFileSync("started", String(process.pid));
writeFileSync("launch.json", JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), env: process.env.TOOLKIT_ENV_SENTINEL }));
const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const message = (text, stopReason = "stop") => ({ role: "assistant", content: [{ type: "text", text }], api: "openai-completions", provider: "fixture", model: "exact-model", usage, stopReason, timestamp: Date.now() });
const send = (event) => process.stdout.write(JSON.stringify(event) + "\n");
const response = (command, data) => send({ type: "response", id: command.id, command: command.type, success: true, ...(data && { data }) });
const input = createInterface({ input: process.stdin }); // JSON escapes newlines, so each line is one command.
input.on("close", async () => {
  writeFileSync("stdin-ended", "");
  if (mode === "wait-exit") while (!existsSync("release")) await delay(10);
  if (mode === "fail-after-final") process.exit(7);
  if (mode === "signal-exit") process.kill(process.pid, "SIGUSR2");
  process.exit(0);
});
input.on("line", async line => {
  const command = JSON.parse(line);
  if (command.type === "get_state") {
    response(command, { model: { provider: "fixture", id: mode === "wrong-model" ? "exact-model-larger" : "exact-model" }, thinkingLevel: mode === "wrong-thinking" ? "high" : "off", isStreaming: false, isCompacting: false, messageCount: mode === "history" ? 5 : 0, pendingMessageCount: 0, sessionId: "fixture", autoCompactionEnabled: true, steeringMode: "one-at-a-time", followUpMode: "one-at-a-time" });
    return;
  }
  if (command.type !== "prompt") { response(command); return; }
  writeFileSync("prompt-received", command.message);
  if (mode === "prompt-failure") { send({ type: "response", id: command.id, command: "prompt", success: false, error: "preflight failed" }); return; }
  response(command);
  if (["hang", "ignore-term", "detached-tool", "pi-bash"].includes(mode)) {
    if (mode !== "hang") process.on("SIGTERM", () => {});
    const pids = [process.pid];
    if (mode === "detached-tool") {
      const child = spawn(process.execPath, ["-e", 'process.on("SIGTERM",()=>{}); require("node:fs").writeFileSync("tool-ready", String(process.pid)); setInterval(()=>{},1000)'], { detached: true, stdio: "ignore" });
      while (!existsSync("tool-ready")) await delay(10);
      pids.push(child.pid);
    }
    if (mode === "pi-bash") {
      const { createBashTool } = await import("@earendil-works/pi-coding-agent");
      void createBashTool(process.cwd()).execute("bash", { command: 'echo $$ > shell-pid; node -e \'process.on("SIGTERM",()=>{}); require("node:fs").writeFileSync("tool-ready",String(process.pid)); setInterval(()=>{},1000)\'; wait' }, undefined).catch(() => {});
      while (!existsSync("tool-ready")) await delay(10);
      pids.push(Number(readFileSync("shell-pid", "utf8")), Number(readFileSync("tool-ready", "utf8")));
    }
    writeFileSync("ready", JSON.stringify(pids));
    setInterval(() => {}, 1000);
    return;
  }
  if (mode === "malformed") { process.stdout.write("not json\n"); return; }
  if (mode === "oversized") { process.stdout.write("x".repeat(9 * 1024 * 1024)); return; }
  if (mode === "invalid-shape") { send(null); return; }
  if (mode === "stderr") { process.stderr.write((process.env.LLAMA_API_KEY + " stderr\n").repeat(20000), () => process.exit(9)); return; }
  send({ type: "agent_start" });
  send({ type: "message_end", message: message("intermediate", "toolUse") });
  let text = "Final café 🐈\u2028report\nsecond block";
  if (mode === "large") text = "café 🐈\n".repeat(7000);
  if (mode === "long-line") text = "x".repeat(70000);
  if (mode === "progress-secret") {
    send({ type: "tool_execution_start", toolCallId: "t", toolName: "bash", args: { command: `echo ${process.env.LLAMA_API_KEY}\n&& ls` } });
    send({ type: "message_update", usage, assistantMessageEvent: { type: "text_delta", delta: process.env.LLAMA_API_KEY + "p".repeat(10000), contentIndex: 0 } });
    text = `Final ${process.env.LLAMA_API_KEY}`;
  }
  let final = message(text, mode === "model-error" ? "error" : mode === "model-abort" ? "aborted" : mode === "length" ? "length" : "stop");
  if (mode === "invalid-text") final.content = [{ type: "text", text: 42 }];
  if (mode === "tool-only") final = { ...final, stopReason: "toolUse", content: [{ type: "toolCall", id: "x", name: "read", arguments: { path: "x" } }] };
  if (!["missing", "intermediate-only"].includes(mode)) {
    if (mode === "split") {
      const bytes = Buffer.from(JSON.stringify({ type: "message_end", message: final }) + "\n");
      for (let i = 0; i < bytes.length; i++) { process.stdout.write(bytes.subarray(i, i + 1)); if (i % 5 === 0) await delay(1); }
    } else send({ type: "message_end", message: final });
  }
  if (mode === "intermediate-only") process.exit(0);
  send({ type: "agent_end", messages: mode === "missing" ? [] : [final] });
  // The runner treats agent_settled, not agent_end, as completion.
  await delay(1);
  send({ type: "agent_settled" });
});
