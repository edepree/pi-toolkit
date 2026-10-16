import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractTodoItems, findFinalPlan, isSafeCommand, markCompletedSteps, planFilePath, slugify } from "../extensions/plan-mode/utils.ts";

const plan = "Intro text\n## Plan: Add Login\n1. Create the login form\n2. Wire the session store\n### Critical files\n- src/login.ts\n### Testing\n1. Run npm test for login\n### Risks\n- none\n### Self-review\n- Coverage: none";

test("findFinalPlan ignores questions and drafts", () => {
  assert.equal(findFinalPlan("Which option? A) one B) two"), undefined);
  assert.equal(findFinalPlan("Draft:\n1. Create the login form\n2. Wire it"), undefined);
  assert.equal(findFinalPlan("### Plan: Not final\n1. Something long"), undefined);
  assert.equal(findFinalPlan("## Plan:   \n1. Something long"), undefined);
});

test("findFinalPlan returns title and verbatim body from the last heading", () => {
  const found = findFinalPlan(plan);
  assert.equal(found?.title, "Add Login");
  assert.equal(found?.body, plan.slice(plan.indexOf("## Plan:")));
  assert.equal(findFinalPlan("## Plan: Old\n1. a\n## Plan: New\n1. b")?.title, "New");
});

test("extractTodoItems reads only steps before the first ### subsection", () => {
  const items = extractTodoItems(findFinalPlan(plan)!.body);
  assert.deepEqual(items.map(i => i.step), [1, 2]);
  assert.equal(items.every(i => !i.completed), true);
});

test("extractTodoItems keeps the plan's own numbers, markup steps and skips nested lists", () => {
  const items = extractTodoItems("## Plan: X\n1. Add **slugify** to utils\n2. **`utils.ts`**: export it\n   1. nested detail\n3. Run the tests\n### Testing\n- ok");
  assert.deepEqual(items.map(i => i.step), [1, 2, 3]);
  assert.equal(items[0]!.text, "Slugify to utils");
  assert.equal(items[1]!.text, "Utils.ts: export it");
});

test("markCompletedSteps marks [DONE:n]", () => {
  const items = extractTodoItems(findFinalPlan(plan)!.body);
  assert.equal(markCompletedSteps("did it [DONE:2]", items), 1);
  assert.deepEqual(items.map(i => i.completed), [false, true]);
});

test("slugify", () => {
  assert.equal(slugify("Add OAuth: Login/Logout!"), "add-oauth-login-logout");
  assert.equal(slugify("!!!"), "plan");
});

test("planFilePath never reuses an existing file", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "pi-toolkit-plan-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const first = planFilePath(dir, "2026-10-14", "Add Login");
  assert.equal(first, join(dir, "2026-10-14-add-login.md"));
  writeFileSync(first, "x");
  assert.equal(planFilePath(dir, "2026-10-14", "Add Login"), join(dir, "2026-10-14-add-login-2.md"));
});

test("isSafeCommand", () => {
  for (const c of ["git status", "ls -la", "rg foo src"]) assert.equal(isSafeCommand(c), true, c);
  for (const c of ["rm -rf x", "echo hi > f", "npm install", "git commit -m x"]) assert.equal(isSafeCommand(c), false, c);
  for (const c of [
    "curl -sL https://docs.djangoproject.com/en/dev/releases/6.0/ | sed -e 's/<[^>]*>//g' | grep -v '^\\s*$' | head -400",
    "curl -s --max-time 10 https://example.com",
    "pip show django 2>&1",
    "python3 -m pip index versions django 2>/dev/null",
    "python3 --version; ls ~/.cache/pip 2>/dev/null | head",
    'grep "a|b; rm" f',
  ]) assert.equal(isSafeCommand(c), true, c);
  for (const c of [
    "curl -sL https://x.com -o out.html",
    "curl -sLo out.html https://x.com",
    "curl -s -d @key https://x.com",
    "curl -X POST https://x.com",
    'python3 -c "print(1)"',
    "pip download django",
    'ls && python3 -c "open(1)"',
    "env python3 -c 1",
    "find . -delete",
    "find . -exec cat {} +",
    "sed -i s/a/b/ f",
    'echo "$(id)"',
    "cat f | bash",
  ]) assert.equal(isSafeCommand(c), false, c);
});

test("the plan skill carries the final-plan contract and self-review checks", () => {
  const prompt = readFileSync("skills/plan/SKILL.md", "utf8");
  for (const s of ["## Plan: <title>", "### Critical files", "### Testing", "### Risks", "### Self-review",
    "Coverage", "Placeholders", "Consistency", "Scope", "Ambiguity", "one question"]) assert.ok(prompt.includes(s), s);
});

// Drives the real extension with a fake Pi, covering the save/execute menu that needs a UI.
async function planSession(t: test.TestContext, choice: string) {
  const cwd = mkdtempSync(join(tmpdir(), "pi-toolkit-plan-ext-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const handlers = new Map<string, Function>();
  const commands = new Map<string, { handler: Function }>();
  const sent: { content: string }[] = [];
  const notes: { msg: string; level: string | undefined }[] = [];
  let tools = ["read", "bash", "edit", "write"];
  const pi = {
    registerFlag() {}, registerShortcut() {}, getFlag: () => false, appendEntry() {}, sendUserMessage() {},
    registerCommand: (name: string, c: { handler: Function }) => commands.set(name, c),
    on: (event: string, fn: Function) => handlers.set(event, fn),
    getActiveTools: () => tools,
    setActiveTools: (next: string[]) => { tools = next; },
    sendMessage: (m: { content: string }) => sent.push(m),
  };
  const ctx = {
    cwd, hasUI: true,
    ui: {
      select: async () => choice, editor: async () => undefined, setStatus() {}, setWidget() {},
      notify: (msg: string, level?: string) => notes.push({ msg, level }),
      theme: { fg: (_: string, s: string) => s, strikethrough: (s: string) => s },
    },
  };
  const { default: planMode } = await import("../extensions/plan-mode/index.ts");
  planMode(pi as unknown as Parameters<typeof planMode>[0]);
  await commands.get("plan")!.handler("", ctx);
  const finish = (text: string, stopReason = "stop") => handlers.get("agent_end")!({ messages: [{ role: "assistant", stopReason, content: [{ type: "text", text }] }] }, ctx);
  return { cwd, sent, notes, tools: () => tools, finish, handlers };
}

test("guarded plan mode injects its restrictions plus the plan skill body", async (t) => {
  const s = await planSession(t, "Stay");
  const { message } = await s.handlers.get("before_agent_start")!();
  for (const str of ["[PLAN MODE ACTIVE]", "edit and write tools are off", "## 1. Understand", "## 5. Self-review"]) assert.ok(message.content.includes(str), str);
  assert.equal(message.content.includes("description:"), false);
});

test("Save only writes the plan, never overwrites, and stays in plan mode", async (t) => {
  const s = await planSession(t, "Save only");
  await s.finish(plan);
  await s.finish(plan);
  const files = readdirSync(join(s.cwd, "docs", "plans")).sort();
  assert.equal(files.length, 2);
  assert.match(files[0]!, /^\d{4}-\d{2}-\d{2}-add-login-2\.md$/);
  assert.equal(readFileSync(join(s.cwd, "docs", "plans", files[1]!), "utf8"), `${plan.slice(plan.indexOf("## Plan:"))}\n`);
  assert.equal(s.tools().includes("edit"), false);
  assert.equal(s.sent.length, 0);
});

test("a reply without the final heading, or an aborted one, shows no menu and saves nothing", async (t) => {
  const s = await planSession(t, "Save only");
  await s.finish("Which option? A) one B) two");
  await s.finish(plan, "aborted");
  assert.equal(existsSync(join(s.cwd, "docs")), false);
});

test("Save & execute restores tools and sends tracked steps naming the file", async (t) => {
  const s = await planSession(t, "Save & execute");
  await s.finish(plan);
  assert.equal(s.tools().includes("edit"), true);
  const exec = s.sent.at(-1)!.content;
  assert.match(exec, /^Execute the plan in docs\/plans\/\d{4}-\d{2}-\d{2}-add-login\.md\./);
  assert.match(exec, /1\. Login form\n2\. Wire the session store/);
  assert.match(exec, /\[DONE:n\]/);
});

test("a failed save notifies an error and keeps plan mode", async (t) => {
  const s = await planSession(t, "Save & execute");
  writeFileSync(join(s.cwd, "docs"), "not a directory");
  await s.finish(plan);
  assert.equal(s.notes.at(-1)?.level, "error");
  assert.equal(s.tools().includes("edit"), false);
  assert.equal(s.sent.length, 0);
});
