import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, getPackageDir, getMarkdownTheme, parseFrontmatter, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { runChild, type ChildUsage } from "../lib/run-child.ts";

function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  return `${(count / 1000000).toFixed(1)}M`;
}

function formatUsage(usage: ChildUsage, contextWindow: number): string {
  const parts: string[] = [];
  if (usage.turns) parts.push(`${usage.turns} turn${usage.turns > 1 ? "s" : ""}`);
  if (usage.input) parts.push(`↑${formatTokens(usage.input)}`);
  if (usage.output) parts.push(`↓${formatTokens(usage.output)}`);
  if (usage.cacheRead) parts.push(`R${formatTokens(usage.cacheRead)}`);
  if (usage.cacheWrite) parts.push(`W${formatTokens(usage.cacheWrite)}`);
  if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
  if (usage.contextTokens > 0 && contextWindow > 0) {
    const pct = Math.min(100, (usage.contextTokens / contextWindow) * 100);
    const filled = Math.round((pct / 100) * 16);
    parts.push(`ctx:${formatTokens(usage.contextTokens)}/${formatTokens(contextWindow)}`, `${pct.toFixed(1)}% [${"█".repeat(filled)}${"░".repeat(16 - filled)}]`);
  }
  return parts.join(" ");
}

const agentsDir = resolve(import.meta.dirname, "../agents");
interface Agent { name: string; description: string; tools: string; prompt: string }
function loadAgent(file: string): Agent {
  const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(readFileSync(resolve(agentsDir, file), "utf8"));
  const { name, description, tools } = frontmatter;
  const prompt = body.trim();
  if (typeof name !== "string" || typeof description !== "string" || typeof tools !== "string" || !prompt) {
    throw new Error(`Invalid agent file ${file}: needs name, description, tools and a prompt body`);
  }
  return { name, description, tools, prompt };
}
const agentFiles = readdirSync(agentsDir).filter(file => file.endsWith(".md")).sort();
const roles: Record<string, Agent> = {};
for (const agent of agentFiles.map(loadAgent)) {
  if (roles[agent.name]) throw new Error(`Duplicate agent name ${agent.name}`);
  roles[agent.name] = agent;
}
const agentList = Object.values(roles).map(agent => `${agent.name}: ${agent.description}`).join("; ");

// Use the Pi CLI of the runtime that loaded this extension. process.argv[1]
// can be an SDK host, test runner or wrapper, so it is not used.
function piCommand(): string {
  const root = getPackageDir();
  const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  if (manifest.name !== "@earendil-works/pi-coding-agent" || typeof manifest.bin?.pi !== "string") throw new Error("Cannot resolve installed Pi CLI; use a Node package installation");
  const command = resolve(root, manifest.bin.pi);
  if (!existsSync(command)) throw new Error("Installed Pi CLI is missing");
  return command;
}

export default function (pi: ExtensionAPI) {
  let active: { controller: AbortController; done: Promise<void> } | undefined;
  let shuttingDown = false;
  pi.on("session_shutdown", async () => {
    shuttingDown = true;
    active?.controller.abort();
    await active?.done;
  });
  pi.registerTool({
    name: "serial_subagent",
    label: "Serial subagent",
    description: `Run one blocking agent in a fresh Pi process. Agents: ${agentList}. Linux only. Child extensions (including permission extensions) are disabled: not a sandbox. Output is limited to ${formatSize(DEFAULT_MAX_BYTES)}/${DEFAULT_MAX_LINES} lines; when truncated, the full report is saved to a private file and its path is returned.`,
    promptSnippet: "Delegate a self-contained task, blocking until the child exits",
    promptGuidelines: [
      "Give serial_subagent a self-contained task with objectives, relevant paths, constraints and completion criteria; no parent conversation is copied.",
      `serial_subagent agents: ${agentList}.`,
      "serial_subagent runs one agent at a time. To chain agents, wait for each result and pass the evidence the next agent needs (such as the diff and test output) in its task.",
      "Do not use serial_subagent to bypass an explicit security restriction: child permission/sandbox extensions are not inherited. Serialization is session-local, not server-wide.",
    ],
    parameters: Type.Object({ agent: StringEnum(Object.keys(roles)), task: Type.String({ minLength: 1 }) }),

    renderResult(result, { expanded, isPartial }, theme, { isError }) {
      const details = result.details as { agent?: string; summary?: string; reportPath?: string; activity?: string[] } | undefined;
      const icon = isPartial ? theme.fg("warning", "⏳") : isError ? theme.fg("error", "✗") : theme.fg("success", "✓");
      const title = `${icon} ${theme.fg("toolTitle", theme.bold(details?.agent ?? "agent"))}`;
      const summary = details?.summary ? theme.fg("dim", details.summary) : "";
      if (isPartial) {
        const lines = (details?.activity ?? []).map(line => theme.fg("muted", line));
        return new Text([summary ? `${title} ${summary}` : title, ...(lines.length ? lines : [theme.fg("muted", "starting…")])].join("\n"), 0, 0);
      }
      const report = details?.reportPath ? theme.fg("dim", `Full report: ${details.reportPath}`) : "";
      if (!expanded) return new Text([summary ? `${title} ${summary}` : title, report].filter(Boolean).join("\n"), 0, 0);
      const text = result.content[0];
      const container = new Container();
      container.addChild(new Text(title, 0, 0));
      container.addChild(new Spacer(1));
      container.addChild(new Markdown(text?.type === "text" ? text.text : "(no output)", 0, 0, getMarkdownTheme()));
      if (summary) { container.addChild(new Spacer(1)); container.addChild(new Text(summary, 0, 0)); }
      if (report) container.addChild(new Text(report, 0, 0));
      return container;
    },
    executionMode: "sequential",
    async execute(_id, params, signal, onUpdate, ctx) {
      // The schema's minLength still accepts whitespace-only tasks.
      if (!params.task.trim()) throw new Error("task must not be blank");
      if (!ctx.model) throw new Error("An active parent model is required");
      if (active) throw new Error("serial_subagent is busy: a child is still running or cleaning up");
      if (shuttingDown) throw new Error("serial_subagent session is shutting down");
      const { provider, id: model, contextWindow } = ctx.model;
      const controller = new AbortController();
      let complete!: () => void;
      active = { controller, done: new Promise<void>(resolve => { complete = resolve; }) };
      const abort = () => controller.abort();
      signal?.addEventListener("abort", abort, { once: true });
      try {
        if (signal?.aborted) abort();
        const role = roles[params.agent];
        const thinkingLevel = ctx.thinkingLevel ?? "off";
        const report = await runChild({
          command: process.execPath,
          args: [piCommand(), "--mode", "rpc", "--no-session", "--no-extensions", "--no-prompt-templates",
            "--tools", role.tools, "--provider", provider, "--model", model, "--thinking", thinkingLevel,
            ctx.isProjectTrusted() ? "--approve" : "--no-approve", "--append-system-prompt", role.prompt],
          cwd: ctx.cwd,
          prompt: `Task: ${params.task}`,
          expected: { provider, model, thinkingLevel },
          signal: controller.signal,
          onProgress: ({ usage, activity }) => {
            const summary = formatUsage(usage, contextWindow);
            onUpdate?.({ content: [{ type: "text", text: activity.at(-1) ?? "Working…" }], details: { agent: params.agent, summary, activity } });
          },
        });
        return { content: [{ type: "text", text: report.text }], details: { agent: params.agent, summary: formatUsage(report.usage, contextWindow), reportPath: report.reportPath } };
      } finally {
        signal?.removeEventListener("abort", abort);
        active = undefined;
        complete();
      }
    },
  });
}
