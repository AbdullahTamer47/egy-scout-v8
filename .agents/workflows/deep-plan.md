---
description: Deep architectural planning workflow — dependency impact, edge cases, rollback safety, and verification checklist before coding complex features.
---

# Deep Plan Workflow

Execute before modifying 2+ files or shared modules:

1. **Orient:** Read `.agents/rules/project-map.md` and locate exact target symbols with `rg -n` (never scan whole repo).
2. **Dependency & Impact Analysis:**
   - Trace all upstream callers and downstream consumers of every symbol/API/schema you plan to change.
   - Check backward compatibility (API payloads, DB schema, Zustand store consumers).
3. **Edge-Case & Constraint Audit:**
   - List boundary conditions (empty inputs, uncalibrated frames, missing IDs, CPU/memory/disk limits on `C:` vs `D:`).
   - Identify security, privacy, or data-integrity risks.
4. **Rollback Safety:** Note how the change can be cleanly reverted if verification fails.
5. **Step-by-Step File Plan:** List exact files, line-level edits, and why each change is needed.
6. **Verification Checklist:** Define exact targeted commands (`compileall`, `tsc --noEmit`, `npm run build`, API smoke test) to run after implementation.
