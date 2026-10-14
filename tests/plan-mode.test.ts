import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
});

test("prompt.md carries the final-plan contract and self-review checks", () => {
  const prompt = readFileSync("extensions/plan-mode/prompt.md", "utf8");
  for (const s of ["## Plan: <title>", "### Critical files", "### Testing", "### Risks", "### Self-review",
    "Coverage", "Placeholders", "Consistency", "Scope", "Ambiguity", "one question"]) assert.ok(prompt.includes(s), s);
});
