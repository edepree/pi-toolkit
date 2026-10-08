import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, getPackageDir, getMarkdownTheme, parseFrontmatter, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import { StringEnum, clampThinkingLevel } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { ChildError, runChild, type ChildStats } from "../lib/run-child.ts";

function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  return `${(count / 1000000).toFixed(1)}M`;
}

function formatUsage({ usage, turns, contextTokens }: ChildStats, contextWindow: number): string {
  const parts: string[] = [];
  if (turns) parts.push(`${turns} turn${turns > 1 ? "s" : ""}`);
  if (usage.input) parts.push(`↑${formatTokens(usage.input)}`);
  if (usage.output) parts.push(`↓${formatTokens(usage.output)}`);
  if (usage.cacheRead) parts.push(`R${formatTokens(usage.cacheRead)}`);
  if (usage.cacheWrite) parts.push(`W${formatTokens(usage.cacheWrite)}`);
  if (usage.cost.total) parts.push(`$${usage.cost.total.toFixed(4)}`);
  if (contextTokens > 0 && contextWindow > 0) {
    const pct = Math.min(100, (contextTokens / contextWindow) * 100);
    const filled = Math.round((pct / 100) * 16);
    parts.push(`ctx:${formatTokens(contextTokens)}/${formatTokens(contextWindow)}`, `${pct.toFixed(1)}% [${"█".repeat(filled)}${"░".repeat(16 - filled)}]`);
  }
  return parts.join(" ");
}

// "provider/id"; the id may itself contain "/" (e.g. openrouter/anthropic/claude-x).
function splitModel(ref: string): [string, string] | undefined {
  const slash = ref.indexOf("/");
  return slash > 0 && slash < ref.length - 1 ? [ref.slice(0, slash), ref.slice(slash + 1)] : undefined;
}

const agentsDir = resolve(import.meta.dirname, "../agents");
interface Agent { name: string; description: string; tools: string; model?: string; prompt: string }
function loadAgent(file: string): Agent {
  const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(readFileSync(resolve(agentsDir, file), "utf8"));
  const { name, description, tools, model } = frontmatter;
  const prompt = body.trim();
  if (typeof name !== "string" || typeof description !== "string" || typeof tools !== "string" || !prompt) {
    throw new Error(`Invalid agent file ${file}: needs name, description, tools and a prompt body`);
  }
  if (model !== undefined && !(typeof model === "string" && splitModel(model))) throw new Error(`Invalid agent file ${file}: model must be provider/id`);
  return { name, description, tools, prompt, ...(typeof model === "string" && { model }) };
}
const agentFiles = readdirSync(agentsDir).filter(file => file.endsWith(".md")).sort();
const roles: Record<string, Agent> = {};
for (const agent of agentFiles.map(loadAgent)) {
  if (roles[agent.name]) throw new Error(`Duplicate agent name ${agent.name}`);
  roles[agent.name] = agent;
}
const agentList = Object.values(roles).map(agent => `${agent.name}: ${agent.description}${agent.model ? ` (default model ${agent.model})` : ""}`).join("; ");

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

const parameters = Type.Object({
  agent: StringEnum(Object.keys(roles)),
  task: Type.String({ minLength: 1 }),
  model: Type.Optional(Type.String({ description: "provider/id of the child model; defaults to the agent's model, then the parent's" })),
});
// Optional because results persisted by older versions may lack fields.
interface SubagentDetails { agent?: string; model?: string; summary?: string; reportPath?: string; activity?: string[] }

export default function (pi: ExtensionAPI) {
  let active: { controller: AbortController; done: Promise<void> } | undefined;
  let shuttingDown = false;
  pi.on("session_shutdown", async () => {
    shuttingDown = true;
    active?.controller.abort();
    await active?.done;
  });
  pi.registerTool<typeof parameters, SubagentDetails>({
    name: "serial_subagent",
    label: "Serial subagent",
    description: `Run one blocking agent in a fresh Pi process. Agents: ${agentList}. Not supported on Windows. Child extensions (including permission extensions) are disabled: not a sandbox. Output is limited to ${formatSize(DEFAULT_MAX_BYTES)}/${DEFAULT_MAX_LINES} lines; when truncated, the full report is saved to a private file and its path is returned.`,
    promptSnippet: "Delegate a self-contained task, blocking until the child exits",
    promptGuidelines: [
      "Give serial_subagent a self-contained task with objectives, relevant paths, constraints and completion criteria; no parent conversation is copied.",
      `serial_subagent agents: ${agentList}.`,
      "serial_subagent runs one agent at a time. To chain agents, wait for each result and pass the evidence the next agent needs (such as the diff and test output) in its task.",
      "serial_subagent model is optional (provider/id); it overrides the agent's default model, which otherwise falls back to your own model. Only configured models with credentials work.",
      "Do not use serial_subagent to bypass an explicit security restriction: child permission/sandbox extensions are not inherited. Serialization is session-local, not server-wide.",
    ],
    parameters,
    // Orchestrates a whole child agent; codemode scripts must not fan it out.
    exposure: "model-only",

    renderResult(result, { expanded, isPartial }, theme, { isError, durationMs }) {
      const details: SubagentDetails | undefined = result.details;
      const icon = isPartial ? theme.fg("warning", "⏳") : isError ? theme.fg("error", "✗") : theme.fg("success", "✓");
      const title = `${icon} ${theme.fg("toolTitle", theme.bold(details?.agent ?? "agent"))}${details?.model ? theme.fg("muted", ` ${details.model}`) : ""}`;
      const took = !isPartial && durationMs !== undefined ? `${(durationMs / 1000).toFixed(1)}s` : "";
      const info = [details?.summary, took].filter(Boolean).join(" ");
      const summary = info ? theme.fg("dim", info) : "";
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
      const role = roles[params.agent];
      if (!role) throw new Error(`Unknown agent ${params.agent}`);
      const ref = params.model?.trim() || role.model;
      const parts: [string, string] | undefined = ref ? splitModel(ref) : [ctx.model.provider, ctx.model.id];
      if (!parts) throw new Error(`model must be provider/id, got "${ref}"`);
      const childModel = ctx.modelRegistry.find(parts[0], parts[1]);
      if (!childModel) throw new Error(`Unknown model ${parts.join("/")}`);
      // Virtual models are routed by parent extensions, which the --no-extensions child lacks.
      if (childModel.api === "pi-virtual") throw new Error(`Virtual model ${parts.join("/")} is unavailable to subagents; pick a physical model`);
      if (!ctx.modelRegistry.hasConfiguredAuth(childModel)) throw new Error(`No credentials configured for ${parts.join("/")}`);
      const { provider, id: model, contextWindow } = childModel;
      // Same clamp Pi applies at startup, so the child's get_state identity check still matches.
      const thinkingLevel = clampThinkingLevel(childModel, ctx.thinkingLevel ?? "off");
      // --no-extensions also drops built-ins since Pi 0.99; llama.cpp is a built-in provider.
      const builtins = provider === "llama.cpp" ? ["-e", "builtin:llama.cpp"] : [];
      const controller = new AbortController();
      const { promise: done, resolve: complete } = Promise.withResolvers<void>();
      active = { controller, done };
      const details = { agent: params.agent, model: `${provider}/${model}` };
      try {
        const report = await runChild({
          command: process.execPath,
          args: [piCommand(), "--mode", "rpc", "--no-session", "--no-extensions", "--no-prompt-templates", ...builtins,
            "--tools", role.tools, "--provider", provider, "--model", model, "--thinking", thinkingLevel,
            ctx.isProjectTrusted() ? "--approve" : "--no-approve", "--append-system-prompt", role.prompt],
          cwd: ctx.cwd,
          prompt: `Task: ${params.task}`,
          expected: { provider, model, thinkingLevel },
          signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
          onProgress: ({ stats, activity }) => {
            onUpdate?.({ content: [{ type: "text", text: activity.at(-1) ?? "Working…" }], details: { ...details, summary: formatUsage(stats, contextWindow), activity } });
          },
        });
        return { content: [{ type: "text", text: report.text }], details: { ...details, summary: formatUsage(report.stats, contextWindow), ...(report.reportPath && { reportPath: report.reportPath }) }, usage: report.stats.usage };
      } catch (error) {
        if (!(error instanceof ChildError)) throw error;
        // Returned rather than thrown so the child's spend still counts toward session totals.
        return { content: [{ type: "text", text: error.message }], details: { ...details, summary: formatUsage(error.stats, contextWindow) }, usage: error.stats.usage, isError: true };
      } finally {
        active = undefined;
        complete();
      }
    },
  });
}
