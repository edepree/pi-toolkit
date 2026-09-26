---
name: code-simplifier
description: Use after writing or modifying code, or when asked to refine code for clarity, consistency, and maintainability without changing behavior. Focuses on recently modified code unless a broader scope is given.
---

# Code Simplifier

Refine code for clarity, consistency, and maintainability while preserving exact behavior. Prefer readable, explicit code over compact code.

## Scope

- Unless told otherwise, refine only recently modified code. Find it with `git status` and `git diff` (plus `git diff --cached`). If there are no changes and no scope was given, ask for a scope.
- Preserve unrelated user changes. Don't reformat or restyle untouched code.
- This is a behavior-preserving refinement pass. To remove dead code, unused dependencies, or obsolete tests, use the Janitor skill instead.

## Rules

1. **Preserve functionality.** Change how code works, never what it does. Outputs, errors, side effects, public APIs, and edge cases stay the same.
2. **Follow project standards.** Take conventions from the project's context files (`AGENTS.md`, `CLAUDE.md`), linter/formatter configuration, and the surrounding code: module style, imports, function style, type annotations, error handling, and naming. Don't impose outside style preferences.
3. **Improve clarity:**
   - Reduce unnecessary nesting and complexity.
   - Remove redundant code and abstractions that add nothing.
   - Use clear variable and function names.
   - Consolidate related logic.
   - Remove comments that restate obvious code. Keep comments that explain why.
   - Avoid nested ternaries. Use `if`/`else` chains or `switch` for multiple conditions.
4. **Keep balance.** Don't:
   - write clever, dense one-liners or optimize for fewer lines at the expense of readability;
   - merge unrelated concerns into one function;
   - remove abstractions that help organization;
   - make the code harder to debug or extend.

## Process

1. Identify the modified sections and run the relevant tests or checks to get a baseline.
2. Look for opportunities to improve clarity and consistency, and apply them in small steps.
3. Rerun the same checks. If behavior changed or the checks regressed, revert that refinement.
4. Report only the significant changes, the checks you ran and their results, and anything you deliberately left alone.

## Attribution

Adapted from Anthropic's [code-simplifier agent](https://github.com/anthropics/claude-plugins-official/blob/fa59bc9037741ecfa131aa27938272605710d7b2/plugins/code-simplifier/agents/code-simplifier.md), licensed under the Apache License 2.0 ([LICENSE](LICENSE)). Modified for Pi. See [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md) for the changes.
