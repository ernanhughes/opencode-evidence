# DESIGN.md — opencode-evidence v0.1

## Responsibility

Capture, normalize, identify, and preserve observations as `EvidenceRecord`s.
One question only: **what was observed?**

## Non-responsibilities

- Deciding whether evidence satisfies a criterion (→ `opencode-verify`).
- Packaging claims into durable artifacts (→ `opencode-proof`).
- Judging truth, trustworthiness, or task success.
- Executing commands (compose with the shell; `evidence_command` wraps results).
- Anything requiring model inference. The core has no model dependency.

Non-goals: truth engine, claim verifier, proof system, RAG, memory system,
knowledge graph, authority engine, general shell replacement, LLM judge,
embeddings, semantic search, remote upload, signing/certificate chains.

## Evidence schema

`schema: "opencode.evidence.v1"`. Fields: `evidence_id`, `kind` (7-member
union), optional `subject`, `observation` (any JSON), `source`
(`kind` + optional `locator`/`version`), `observed_at`, `content_hash`
(64 hex), `producer` (`plugin: "opencode-evidence"` + version), optional
`metadata` object.

Top-level verdict-shaped fields (`verified`, `verdict`, `confidence`,
`trust_score`, `claim_verified`, `task_verified`, `task_success`, `proves`,
`proof`, `valid`, `success`) are **rejected** by `validateRecord`
(`EVIDENCE_VERDICT_FIELD`). Caller data nested under `observation` may
contain such words as inert bytes; nothing in the core interprets them.

## Identity / integrity semantics

- Canonicalization: recursive key sort (UTF-16 code-unit order), no
  whitespace; `undefined` object props dropped, `undefined` array items →
  `null`, non-finite numbers → `null`, `Date` → ISO; `bigint`/`function`/
  `symbol` throw (`src/canonical.ts`).
- `content_hash = sha256(canonical({kind, subject ?? null, observation,
  source(kind, locator ?? null, version ?? null)}))`.
- `evidence_id = "ev_" + content_hash[0:32]`.
- `observed_at`, `producer`, storage path are **excluded** from identity:
  same observation re-captured → same id (idempotent); copies keep identity.
- `verifyIntegrity` recomputes hash + id and compares (`EVIDENCE_HASH_MISMATCH`
  / `EVIDENCE_ID_MISMATCH`). Hash ⇒ byte-identity, never truth.

## Storage

`EvidenceStore` over `<storeDir>/records/<id>.json`, pretty-printed
canonical JSON. Atomic put (tmp + rename); byte-identical re-put →
`duplicate: true`; same-id divergence → `EVIDENCE_ID_COLLISION`; malformed
disk content → `EVIDENCE_MALFORMED` / `EVIDENCE_SCHEMA_MISMATCH` /
`EVIDENCE_NOT_FOUND`; 1 MiB per-record cap; `get` is read-only.

Default store lives in user-data space, namespaced `ev-<sha256(project
path)[0:12]>` — never inside the repo unless explicitly configured
(`OPENCODE_EVIDENCE_DIR` or `<project>/.opencode/evidence.json`).

## Privacy

Only caller-supplied or file-read bytes are persisted. Bounds:
stdout/stderr 16k chars, file excerpt 8 KiB, file hash cap 20 MiB
(metadata-only above), structured observation 256 KiB. No env vars, no
network, no uploads.

## OpenCode integration

`Plugin.define({ id: "opencode-evidence", setup })` registers six tools via
`ctx.tool.transform`. Startup does a non-fatal readiness warning only — an
unready store must not break an unrelated session. Tool `execute` returns
`{ content: JSON string }` and converts internal errors to
`{ ok: false, error }` payloads (except health, which returns the doctor
object directly). `evidence_command` deliberately has no exec path.

## Future extension points (not built)

New `EvidenceKind`s, `http_observation`/`git_observation` constructors
(currently via `structured_observation`), optional project-local store
profiles, and whatever contract `opencode-verify` needs to *read* records
(the schema is stable at `opencode.evidence.v1`; verify must not require
writes here).
