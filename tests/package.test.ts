import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DefaultResourceLoader, SettingsManager, loadSkills, parseFrontmatter } from "@earendil-works/pi-coding-agent";

test("Pi discovers Janitor from the declared skill paths without warnings", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const { frontmatter } = parseFrontmatter(readFileSync("skills/janitor/SKILL.md", "utf8"));
  assert.equal(frontmatter.name, "janitor");

  const { skills, diagnostics } = loadSkills({
    cwd: process.cwd(),
    agentDir: process.cwd(),
    skillPaths: pkg.pi.skills,
    includeDefaults: false,
  });
  assert.deepEqual(diagnostics, []);
  assert.deepEqual(skills.map((skill) => skill.name), ["code-simplifier", "janitor"]);
  assert.equal(skills.find(s => s.name === "janitor")!.filePath, resolve("skills/janitor/SKILL.md"));
  assert.equal(skills.every(s => !s.disableModelInvocation), true);
});

test("actual Pi resource loader discovers the registered sequential extension in isolated settings", async (t) => {
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
  assert.equal(result.extensions.length, 1);
  const tools = result.extensions[0].tools;
  assert.deepEqual([...tools.keys()], ["serial_subagent"]);
  assert.equal(tools.get("serial_subagent")!.definition.executionMode, "sequential");
});
