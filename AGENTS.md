# AGENTS.md — working rules for opencode-evidence

This repo records observations. It must never grow judgment. Every change
below is a review gate, not just style.

## Hard boundaries

1. **Evidence records observations.** Never add a field, tool, or code path
   that decides whether evidence proves a claim, whether a task succeeded,
   or whether an action may execute.
2. **Never add verification semantics without explicit architectural review.**
   Words like `verified`, `verdict`, `confidence`, `trust`, `proves`,
   `success` must not appear as record fields, tool outputs-as-judgment, or
   helper return values. `FORBIDDEN_TOP_LEVEL_FIELDS` in `src/schema.ts` is
   the enforced list — extend it, never shrink it, without review.
3. **Model statements are not evidence.** Do not add LLM summarization,
   extraction, kind-guessing, or normalization that requires inference.
   The core path (`buildRecord` → `put` → `get`) must stay pure runtime work.
4. **Exit-code success is not task success.** `exit_code: 0` is data. Never
   derive `success`/`passed` verdicts from it. Tests pin this; keep them.
5. **Observation is not conclusion.** `evidence_explain` explains provenance
   and integrity. It must not rank, recommend, or clear anything.

## Determinism and purity

- Keep canonicalization total and deterministic; document any rule change
  (it changes hashes for everyone).
- Identity inputs are `{kind, subject, observation, source}` only. Do not
  fold time, producer, or storage location into identity without review.
- `EvidenceStore.get` must stay read-only. `put` stays atomic + idempotent +
  collision-loud.
- Keep inference out of the core: no model SDKs, no network calls, no
  embeddings. Dependency additions need justification in the PR.

## Size and privacy discipline

- Bounds in `src/capture.ts` (`MAX_OUTPUT_CHARS`, `MAX_EXCERPT_BYTES`,
  `MAX_FILE_HASH_BYTES`, `MAX_OBSERVATION_BYTES`) are safety properties.
  Raising them needs justification; silent truncation (without a
  `*_truncated`/`content_omitted` flag) is a bug.
- Never capture env vars, secrets, or files the caller did not name.
- Default storage stays outside the repo. Do not change the default to a
  committed location.

## Tests must pin boundaries, not only happy paths

- Every new constructor needs: round-trip, determinism, tamper-rejection,
  and a "does not promote data to verdict" test.
- Adversarial fixtures to keep: `{claim, confidence}` observations,
  `exit_code: 0`, same-id-divergent bytes, malformed disk content.
- Gate: `bun run check` (typecheck + all tests) green before commit.

## Sibling repos

`opencode-verify` (criteria → PASS/FAIL/INCONCLUSIVE) and `opencode-proof`
(replayable artifacts) are separate. Do not implement their responsibilities
here "temporarily". If verify needs something from evidence, expose reads —
never accept verdict-shaped writes.
