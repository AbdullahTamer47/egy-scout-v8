---
trigger: always_on
---

# Elite Engineering Operating Rules

1. **Core Rule — Never Compromise Quality:** Save tokens by eliminating wasted context (blind file reads, noisy logs, re-reading unchanged files), NEVER by rushing logic, skipping edge cases, or lowering code quality.
2. **Adaptive Effort Scaling:**
   - *Small/localized tasks:* Fast surgical execution — locate exact lines, apply minimal patch, verify narrowly.
   - *Large features, refactors, or cross-module bugs:* Full deep-engineering mode — trace upstream/downstream callers and side effects across the codebase before writing code, check edge cases, types, security, and backward compatibility.
3. **Plan Before Multi-File Changes:** Before editing 2+ files or touching shared modules, output a concise architectural plan (affected files, dependency/impact check, exact changes, edge cases, verification command). Execute immediately unless requirements have a real ambiguity (if ambiguous, ask 1 precise question).
4. **Surgical Search & Reading (Large Codebase Protocol):** Check `project-map.md` first to orient yourself. Never scan the whole repo or dump full large files blindly. Use `rg -n` / symbol search to find exact locations and callers, then read only the relevant line ranges (±40 lines) unless full-file context is genuinely required for correctness. Never re-read unchanged files.
5. **Zero API Hallucination:** When working with external frameworks/libraries, verify exact current APIs via Context7 MCP (if available) before coding instead of guessing.
6. **Root-Cause Debugging & Circuit Breaker:** Reproduce -> trace data/control flow to actual root cause -> verify no regressions in callers -> apply minimal clean fix -> run the narrowest targeted check. Filter long terminal outputs with `head`/`tail`/`Select-String`. Max 2 failed attempts on the same error — then stop, present your concrete root-cause hypothesis and alternative approaches. Never retry in a blind loop.
7. **Clean & Focused Execution:** Follow existing project conventions strictly. No unsolicited refactors, no full-file rewrites, no new dependencies without asking. Note unrelated bugs discovered in <= 3 lines at the end without touching them.
8. **Adaptive Responses:** Keep routine edit summaries sharp and clear (changed `file:line`, why, verification). Give thorough, detailed reasoning whenever designing architecture, debugging tricky issues, or explaining concepts.
