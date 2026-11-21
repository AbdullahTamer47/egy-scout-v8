---
description: Strict pre-merge/post-edit diff review for logic bugs, breaking caller changes, security holes, performance bottlenecks, and missing edge cases.
---

# Strict Review Workflow

1. **Inspect Diff (Read-Only):** Run `git status` and `git diff` (or `git diff --staged`) scoped to changed files; filter noise if large.
2. **Caller & Contract Check:** For every modified function, endpoint, or type, verify all callers via `rg -n` still match signatures and return shapes.
3. **Bug & Edge-Case Audit:** Check null/empty handling, off-by-one, async race conditions, error propagation, and type safety.
4. **Security & Secrets Audit:** Confirm zero hardcoded secrets, no `.env` exposure, no unsafe path traversal, and no bypassed auth/validation.
5. **Performance Check:** Flag O(N²) loops on large arrays, heavy work inside 60fps `requestAnimationFrame`, or unthrottled React state updates.
6. **Report:** Output concise findings grouped by Severity (`Blocker` / `Warning` / `Nit`) with exact `file:line` references.
