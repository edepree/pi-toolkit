import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DefaultResourceLoader, SettingsManager, loadSkills, parseFrontmatter } from "@earendil-works/pi-coding-agent";

test("Pi discovers Janitor from the declared skill paths without warnings", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const { frontmatter } = parseFrontmatter(readFileSync("skills/janitor/SKILL.md", "utf8"));
  assert.equal(frontmatter["name"], "janitor");

  const { skills, diagnostics } = loadSkills({
    cwd: process.cwd(),
    agentDir: process.cwd(),
    skillPaths: pkg.pi.skills,
    includeDefaults: false,
  });
  assert.deepEqual(diagnostics, []);
  assert.deepEqual(skills.map((skill) => skill.name), ["code-simplifier", "janitor", "lean-comments"]);
  assert.equal(skills.find(s => s.name === "janitor")!.filePath, resolve("skills/janitor/SKILL.md"));
  assert.equal(skills.every(s => !s.disableModelInvocation), true);
});

test("actual Pi resource loader discovers both registered extensions in isolated settings", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "pi-toolkit-loader-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const loader = new DefaultResourceLoader({
    cwd: dir, agentDir: dir,
    settingsManager: SettingsManager.inMemory({ packages: [process.cwd()] }, { projectTrusted: false }),
    noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
  });
  await loader.reload();
  const result = loader.getExtensions();
  assert.deepEqual(result.errors, []);
  assert.equal(result.extensions.length, 2);
  const tools = result.extensions.find(e => e.tools.has("serial_subagent"))!.tools;
  assert.deepEqual([...tools.keys()], ["serial_subagent"]);
  assert.equal(tools.get("serial_subagent")!.definition.executionMode, "sequential");
  assert.equal(tools.get("serial_subagent")!.definition.exposure, "model-only");
  const plan = result.extensions.find(e => e.commands.has("plan"))!;
  assert.deepEqual([...plan.commands.keys()].sort(), ["plan", "todos"]);
  assert.equal(plan.flags.has("plan"), true);
});

// The loader test above reads the working tree, so it passes even when "files" omits a resource.
test("published tarball carries every declared extension and resource file", { timeout: 60000 }, () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const output = execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["pack", "--dry-run", "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const packed = new Set<string>(JSON.parse(output)[pkg.name].files.map((file: { path: string }) => file.path));

  for (const entry of pkg.pi.extensions as string[]) assert.ok(packed.has(entry.replace(/^\.\//, "")), `manifest extension ${entry} is missing from the tarball`);
  // Every file under extensions/ and skills/ is a runtime resource: prompts, agents and imported modules.
  const resources = ["extensions", "skills"].flatMap(dir => readdirSync(dir, { recursive: true, withFileTypes: true }).filter(e => e.isFile()).map(e => `${join(e.parentPath, e.name).replaceAll("\\", "/")}`));
  assert.deepEqual(resources.filter(file => !packed.has(file)), []);
  assert.ok(resources.length >= 8, "expected the resource walk to find files");
});
