---
description: Surgical root-cause debugging workflow — reproduce, trace via rg, prove root cause before editing, minimal patch, and targeted regression check.
---

# Surgical Debug Workflow

1. **Reproduce First:** Run the narrowest command or request that triggers the bug; capture exact error/output (filter long logs with `Select-Object -First/-Last` or `rg`).
2. **Trace Data & Control Flow:** Use `rg -n` to find the failing symbol and all call sites; read only ±40 lines around relevant blocks.
3. **Prove Root Cause:** State the exact root cause and affected files/lines *before* editing any file.
4. **Apply Minimal Clean Patch:** Fix the root cause cleanly without unrelated refactors or full-file rewrites.
5. **Targeted Regression Check:** Re-run the reproduction check and affected typecheck/compile check.
6. **Circuit Breaker:** Maximum 2 failed fix attempts on the same error — if still failing, stop and present the root-cause hypothesis and alternative approaches.
