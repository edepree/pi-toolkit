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

## Pi subagent example

`extensions/serial-subagent.ts` and `lib/run-child.ts` adapt the subprocess-delegation
approach of Pi's subagent example, with new fixed roles, sequential execution,
pre-inference RPC identity verification, bounded parsing/reporting, and Linux
process-tree cleanup. They do not include the example's agent discovery,
parallel/chain scheduler, or custom rendering.

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
