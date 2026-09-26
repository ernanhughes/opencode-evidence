# opencode-evidence

**One job:** turn an observable event or state into a normalized,
provenance-bearing `EvidenceRecord`.

```text
observable event/state
        ↓
opencode-evidence
        ↓
EvidenceRecord
```

It answers **"What was actually observed?"** Nothing more.

## The model may propose. The world must provide observations.

A language model saying "the tests pass" is **not** test evidence.
An observed test execution — `command = "bun test"`, `exit_code = 0`,
`stdout = "…43 passed…"` — **can be** evidence.

Likewise, "I changed package.json" is not evidence. An observed file hash,
content excerpt, diff, or repository state can be evidence.

This plugin makes that distinction difficult to accidentally erase.

## Core distinctions

```text
model output      != evidence
observation       != verification
verification      != proof
hash integrity    != truth
command success   != task success
```

An `EvidenceRecord` carries **no verdict fields**: no `verified`, no
`verdict`, no `confidence`, no `task_success`. Schema validation rejects
records that contain them (`EVIDENCE_VERDICT_FIELD`). A caller may store
words like "claim" or "confidence" *inside* `observation` as inert data;
the core never reads them as judgments.

## Composition (future siblings, not this repo)

```text
world/tool
    ↓
EVIDENCE  (this plugin: observation → EvidenceRecord)
    ↓
VERIFY    (opencode-verify: Claim + Criterion + EvidenceRecord[] → PASS | FAIL | INCONCLUSIVE)
    ↓
PROOF     (opencode-proof: durable, replayable ProofArtifact)
```

Evidence can later feed context compilation, remembering, debugging,
experiments, authority decisions, and acceptance gates — with no runtime
dependency on any of them.

## Install

Prerequisites: [Bun](https://bun.sh) ≥ 1.0 (Node ≥ 22 also works for the built output).

```sh
bun install
bun run check   # typecheck + tests
bun run build
```

Add the plugin to OpenCode:

```json
{ "plugins": ["file:///absolute/path/to/opencode-evidence"] }
```

The package entry (`dist/index.js`) exports the plugin. Zero LLM inference
is required at any point — capture, hashing, storage, and health are pure
runtime work.

## Tools

| Tool | Purpose |
|---|---|
| `evidence_record` | Preserve a structured observation as an `EvidenceRecord`. |
| `evidence_command` | Turn an **already-observed** command result into evidence. Does **not** execute commands — observe first with the shell, then record. `exit_code` stays data. |
| `evidence_file` | Observe a file (existence, size, hash, bounded excerpt). Missing files are valid `exists: false` observations. |
| `evidence_get` | Retrieve a record by id. Read-only. |
| `evidence_explain` | Explain a record's fields, provenance, and integrity — plus what it does **not** establish. |
| `evidence_health` | Readiness probe. Runtime checks only, `model_inference: "none"`. |

## EvidenceRecord

Schema id: `opencode.evidence.v1` (see `evidence.example.json`).

```ts
type EvidenceRecord = {
  schema: "opencode.evidence.v1";
  evidence_id: string;          // "ev_" + content_hash[0:32], deterministic
  kind: EvidenceKind;           // command_result | file_observation | test_result
                                // | http_observation | git_observation
                                // | structured_observation | other
  subject?: string;             // label, not a claim
  observation: unknown;         // the observed material. Data only.
  source: { kind: string; locator?: string; version?: string };
  observed_at: string;          // provenance; excluded from identity
  content_hash: string;         // sha256 over canonical {kind,subject,observation,source}
  producer: { plugin: "opencode-evidence"; version: string };
  metadata?: Record<string, unknown>;
};
```

**Identity semantics:** `content_hash = sha256(canonical({kind, subject,
observation, source}))`; `evidence_id` derives from it. Re-capturing the
same observation later yields the same id (idempotent). Copying a record to
another store never changes its identity. `observed_at` and `producer`
describe preservation, not content, and are excluded from the hash.

A content hash gives **integrity/identity**: "this stored record is
byte-identical to what was captured." It does **not** establish who is
trustworthy, whether the observation is true, whether the observer was
compromised, or whether any claim is proved.

## Storage

Default: a user-data location **outside the repository**, namespaced per
project by a hash of the project path:

- Windows: `%APPDATA%\opencode-evidence\projects\ev-<hash12>\records\<id>.json`
- Other: `$XDG_DATA_HOME` or `~/.local/share`, same layout

Evidence can contain secrets and runtime output; it must not become
committed source by accident. Override with `OPENCODE_EVIDENCE_DIR` or
`{ "store_dir": ... }` in `<project>/.opencode/evidence.json`
(project-local stores are explicit opt-in).

Store guarantees: deterministic retrieval by id, atomic write
(tmp + rename), idempotent re-store, `EVIDENCE_ID_COLLISION` instead of
silent overwrite, clear failures for malformed records, read-only
retrieval, 1 MiB per-record cap, human-inspectable JSON files.

## Privacy and limits

- Never records environment variables or secrets; only what the caller passes or the file contains.
- `stdout`/`stderr` capped at 16,000 chars each (flagged `*_truncated`).
- File excerpts capped at 8 KiB; files over 20 MiB get metadata-only records.
- Structured observations capped at 256 KiB canonical.
- Everything stays local. Nothing is uploaded anywhere.

## Checks

```sh
bun run typecheck   # tsc --noEmit
bun test            # 50 tests across 6 files
bun run build       # dist/index.js
bun src/dev-cli.ts load    # plugin loads, 6 tools register, health works
bun src/dev-cli.ts smoke   # file + command demos with hash re-verification
```

A full OpenCode-runtime load (plugin inside a live session) is **UNVERIFIED**
in this environment; the offline `load` check proves module load, tool
registration, and health structurally without inference.

## Boundaries (non-goals)

Truth engine, claim verifier, proof system, RAG, memory system, knowledge
graph, authority engine, shell replacement, LLM judge, embeddings, remote
upload, signing infrastructure. See `DESIGN.md` and `AGENTS.md`.
