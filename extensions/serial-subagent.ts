import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getPackageDir, getMarkdownTheme, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { runChild } from "../lib/run-child.ts";

const DEFAULT_MAX_CONTEXT = 128000;

function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  return `${(count / 1000000).toFixed(1)}M`;
}

function formatProgressBar(pct: number, width: number): string {
  const filled = Math.round((pct / 100) * width);
  const empty = width - filled;
  const bar = "\u2588".repeat(Math.max(0, filled)) + "\u2591".repeat(Math.max(0, empty));
  return `${pct.toFixed(1)}% [${bar}]`;
}

const roles = {
  worker: {
    tools: "read,bash,edit,write,grep,find,ls",
    prompt: "You are the worker for one self-contained delegated task. Implement only its scope, preserve unrelated changes, run relevant checks, and report changed files, exact check results, and unresolved issues. Do not delegate to other agents. Do not disclose credentials. Partial edits remain on failure; do not claim rollback.",
  },
  reviewer: {
    tools: "read,grep,find,ls",
    prompt: "You are the read-only reviewer for one self-contained delegated task. Inspect specified files and supplied diffs/evidence. Report actionable findings with severity and file/line references, or explicitly state no findings and remaining limitations. You cannot edit, run shell commands, obtain git diffs, or rerun tests. Worker test reports are supplied evidence, not independently verified results. Do not delegate to other agents or disclose credentials.",
  },
} as const;

// getPackageDir comes from the Pi runtime that loaded the extension. argv[1]
// may instead be an SDK host, test runner, or wrapper and is never executed.
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
    description: "Run one blocking worker or read-only reviewer in a fresh Pi process. Linux only. Child extensions (including permission extensions) are disabled: not a sandbox. Output is limited to 50 KiB/2,000 lines with private full-report paths when truncated.",
    promptSnippet: "Delegate a self-contained task, blocking until the child exits",
    promptGuidelines: [
      "Give serial_subagent a self-contained task with objectives, relevant paths, constraints and completion criteria; no parent conversation is copied.",
      "Call serial_subagent for a worker first, wait for its result, then explicitly request reviewer work with the diff and test evidence. Reviewers cannot run git diff or tests.",
      "Do not use serial_subagent to bypass an explicit security restriction: child permission/sandbox extensions are not inherited. Serialization is session-local, not server-wide.",
    ],
    parameters: Type.Object({ agent: StringEnum(["worker", "reviewer"] as const), task: Type.String({ minLength: 1 }) }),

    renderResult(result, { expanded }, theme, { isError }) {
      const details = result.details as { reportPath?: string; usage?: { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number; contextTokens?: number; turns?: number }; agent?: string } | undefined;
      const usage = details?.usage;
      const agent = details?.agent ?? "agent";
      const mdTheme = getMarkdownTheme();

      if (expanded) {
        const container = new Container();
        const icon = isError ? theme.fg("error", "✗") : theme.fg("success", "✓");
        container.addChild(new Text(`${icon} ${theme.fg("toolTitle", theme.bold(agent))}`, 0, 0));
        container.addChild(new Spacer(1));
        const text = result.content[0];
        container.addChild(new Markdown(text?.type === "text" ? text.text : "(no output)", 0, 0, mdTheme));
        if (usage) {
          container.addChild(new Spacer(1));
          const parts: string[] = [];
          if (usage.turns) parts.push(`${usage.turns} turn${usage.turns > 1 ? "s" : ""}`);
          if (usage.input) parts.push(`↑${formatTokens(usage.input)}`);
          if (usage.output) parts.push(`↓${formatTokens(usage.output)}`);
          if (usage.cacheRead) parts.push(`R${formatTokens(usage.cacheRead)}`);
          if (usage.cacheWrite) parts.push(`W${formatTokens(usage.cacheWrite)}`);
          if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
          if (usage.contextTokens && usage.contextTokens > 0) {
            const pct = (usage.contextTokens / DEFAULT_MAX_CONTEXT) * 100;
            parts.push(`ctx:${formatTokens(usage.contextTokens)}/${formatTokens(DEFAULT_MAX_CONTEXT)}`);
            parts.push(formatProgressBar(pct, 16));
          }
          container.addChild(new Text(theme.fg("dim", parts.join(" ")), 0, 0));
        }
        if (details?.reportPath) {
          container.addChild(new Text(theme.fg("dim", `Full report: ${details.reportPath}`), 0, 0));
        }
        return container;
      }

      let text = `${isError ? theme.fg("error", "✗") : theme.fg("success", "✓")} ${theme.fg("toolTitle", theme.bold(agent))}`;
      if (usage) {
        const parts: string[] = [];
        if (usage.turns) parts.push(`${usage.turns} turn${usage.turns > 1 ? "s" : ""}`);
        if (usage.input) parts.push(`↑${formatTokens(usage.input)}`);
        if (usage.output) parts.push(`↓${formatTokens(usage.output)}`);
        if (usage.cacheRead) parts.push(`R${formatTokens(usage.cacheRead)}`);
        if (usage.cacheWrite) parts.push(`W${formatTokens(usage.cacheWrite)}`);
        if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
        if (usage.contextTokens && usage.contextTokens > 0) {
          const pct = (usage.contextTokens / DEFAULT_MAX_CONTEXT) * 100;
          parts.push(`ctx:${formatTokens(usage.contextTokens)}/${formatTokens(DEFAULT_MAX_CONTEXT)}`);
          parts.push(formatProgressBar(pct, 16));
        }
        text += ` ${theme.fg("dim", parts.join(" "))}`;
      }
      if (details?.reportPath) {
        text += `\n${theme.fg("dim", `Full report: ${details.reportPath}`)}`;
      }
      return new Text(text, 0, 0);
    },
    executionMode: "sequential",
    async execute(_id, params, signal, onUpdate, ctx) {
      if (params.agent !== "worker" && params.agent !== "reviewer") throw new Error("agent must be worker or reviewer");
      if (typeof params.task !== "string" || !params.task.trim()) throw new Error("task must not be blank");
      if (!ctx.model) throw new Error("An active parent model is required");
      if (active) throw new Error("serial_subagent is busy: a child is still running or cleaning up");
      if (shuttingDown) throw new Error("serial_subagent session is shutting down");
      if (signal?.aborted) throw new Error("Child cancelled before launch");
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
            "--tools", role.tools, "--provider", ctx.model.provider, "--model", ctx.model.id, "--thinking", thinkingLevel,
            ctx.isProjectTrusted() ? "--approve" : "--no-approve", "--append-system-prompt", role.prompt],
          cwd: ctx.cwd,
          prompt: `Task: ${params.task}`,
          expected: { provider: ctx.model.provider, model: ctx.model.id, thinkingLevel },
          signal: controller.signal,
          onProgress: (text) => {
            onUpdate?.({ content: [{ type: "text", text }], details: {} });
          },
          onUsage: (usage) => {
            const pct = usage.contextTokens ? (usage.contextTokens / DEFAULT_MAX_CONTEXT) * 100 : 0;
            const parts: string[] = [];
            if (usage.turns) parts.push(`${usage.turns} turn${usage.turns > 1 ? "s" : ""}`);
            if (usage.input) parts.push(`↑${formatTokens(usage.input)}`);
            if (usage.output) parts.push(`↓${formatTokens(usage.output)}`);
            if (usage.cacheRead) parts.push(`R${formatTokens(usage.cacheRead)}`);
            if (usage.cacheWrite) parts.push(`W${formatTokens(usage.cacheWrite)}`);
            if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
            if (usage.contextTokens && usage.contextTokens > 0) {
              parts.push(`ctx:${formatTokens(usage.contextTokens)}/${formatTokens(DEFAULT_MAX_CONTEXT)}`);
              parts.push(formatProgressBar(pct, 16));
            }
            onUpdate?.({ content: [{ type: "text", text: `Working: ${parts.join(" ")}` }], details: {} });
          },
        });
        return { content: [{ type: "text", text: report.text }], details: { reportPath: report.reportPath, usage: report.usage, agent: params.agent } };
      } finally {
        signal?.removeEventListener("abort", abort);
        active = undefined;
        complete();
      }
    },
  });
}
