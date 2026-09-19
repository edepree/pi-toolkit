import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

test("package declares the Janitor skill", () => {
  assert.ok(existsSync("package.json"), "package manifest is missing");
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.ok(pkg.keywords.includes("pi-package"));
  assert.deepEqual(pkg.pi.skills, ["./skills"]);
  assert.ok(existsSync("skills/janitor/SKILL.md"));
});

test("Pi discovers Janitor from the declared skill paths without warnings", async () => {
  assert.ok(existsSync("package.json"), "package manifest is missing");
  assert.ok(existsSync("skills/janitor/SKILL.md"), "Janitor skill is missing");
  const { loadSkills, parseFrontmatter } = await import("@earendil-works/pi-coding-agent");
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
  assert.deepEqual(skills.map((skill) => skill.name), ["janitor"]);
  assert.equal(skills[0].filePath, resolve("skills/janitor/SKILL.md"));
  assert.equal(skills[0].disableModelInvocation, false);
});
