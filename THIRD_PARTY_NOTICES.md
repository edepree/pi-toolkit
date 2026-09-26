# Third-party notices

## Janitor skill

`skills/janitor/SKILL.md` is adapted from **Universal Janitor** in
[GitHub Awesome Copilot](https://github.com/github/awesome-copilot).

- Source: [`agents/janitor.agent.md`](https://github.com/github/awesome-copilot/blob/4f4796f0bf30e105700f97ed8408c12b6aa95e06/agents/janitor.agent.md)
- License: [`LICENSE`](https://github.com/github/awesome-copilot/blob/4f4796f0bf30e105700f97ed8408c12b6aa95e06/LICENSE)
- Upstream revision: `4f4796f0bf30e105700f97ed8408c12b6aa95e06`

The adaptation retains the deletion-first philosophy, six debt-removal
categories, analysis priorities, and incremental validation. It replaces
VS Code tool metadata and Microsoft Docs MCP assumptions with Pi skill
instructions, bounds dependency/infrastructure changes to the requested scope,
and adds safeguards for actual usage, meaningful tests, unrelated edits,
security, accessibility, and honest validation reporting. Upstream advice to
remove flaky tests or document nothing is replaced with repair and retention
of necessary documentation.

The following upstream license applies to the adapted material. It does not
establish a license for unrelated original repository code.

```text
MIT License

Copyright GitHub, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Code Simplifier skill

`skills/code-simplifier/SKILL.md` is adapted from Anthropic's **code-simplifier**
agent in [claude-plugins-official](https://github.com/anthropics/claude-plugins-official).

- Source: [`plugins/code-simplifier/agents/code-simplifier.md`](https://github.com/anthropics/claude-plugins-official/blob/fa59bc9037741ecfa131aa27938272605710d7b2/plugins/code-simplifier/agents/code-simplifier.md)
- Upstream revision: `fa59bc9037741ecfa131aa27938272605710d7b2`
- License: Apache License 2.0; a copy is included at `skills/code-simplifier/LICENSE`.

Changes from upstream:

- Converted from a Claude Code agent to a Pi skill. Removed the `model` field and the claim that it runs autonomously.
- Replaced the hard-coded standards from Anthropic's own `CLAUDE.md` (the `function` keyword, React patterns, explicit return types) with the project's own conventions.
- Added `git diff`-based scope detection and protection for unrelated changes.
- Added before-and-after validation checks, reverting a refinement if behavior changes.
- Pointed deletion-oriented cleanup to the Janitor skill.

## Pi subagent example

`extensions/serial-subagent.ts` and `lib/run-child.ts` adapt the subprocess-delegation
approach of Pi's subagent example. Changes: agents are loaded only from the
package's `agents/` directory, calls run one at a time, the child's model is
verified over RPC before the task is sent, output parsing and reports are
size-limited, and the child's process tree is cleaned up on Linux. They do not
include the example's user/project agent discovery, parallel/chain scheduler,
or message-history rendering.

- Source: [`packages/coding-agent/examples/extensions/subagent/index.ts`](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/examples/extensions/subagent/index.ts)
- Reference version: installed `@earendil-works/pi-coding-agent` **0.85.1**
- License: [`LICENSE` at v0.85.1](https://github.com/earendil-works/pi/blob/v0.85.1/LICENSE)

The following upstream notice applies to the adapted material and does not
establish a license for unrelated original repository code.

```text
MIT License

Copyright (c) 2025 Mario Zechner

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
