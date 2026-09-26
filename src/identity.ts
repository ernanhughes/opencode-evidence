import { canonicalize, sha256Hex } from "./canonical";
import type { EvidenceRecord } from "./schema";
import { validateRecord } from "./schema";

/**
 * Identity semantics (v0.1):
 *
 * - content_hash = sha256(canonical({ kind, subject, observation, source }))
 * - evidence_id  = "ev_" + content_hash[0:32]
 *
 * Deliberately EXCLUDED from identity: observed_at, producer, storage path.
 * Rationale:
 * - Re-capturing the same observation later yields the same id (idempotent).
 * - Copying a record to another store never changes its identity.
 * - Time and producer remain provenance fields on the record; they describe
 *   when/by what the observation was preserved, not what was observed.
 *
 * This is content identity, not truth: equal hashes mean byte-identical
 * canonical observations, nothing more.
 */
export function identityInput(record: {
  kind: string;
  subject?: string;
  observation: unknown;
  source: { kind: string; locator?: string; version?: string };
}): Record<string, unknown> {
  return {
    kind: record.kind,
    observation: record.observation,
    source: {
      kind: record.source.kind,
      locator: record.source.locator ?? null,
      version: record.source.version ?? null,
    },
    subject: record.subject ?? null,
  };
}

export function computeContentHash(input: {
  kind: string;
  subject?: string;
  observation: unknown;
  source: { kind: string; locator?: string; version?: string };
}): string {
  return sha256Hex(canonicalize(identityInput(input)));
}

export function deriveEvidenceId(contentHash: string): string {
  return `ev_${contentHash.slice(0, 32)}`;
}

export type IntegrityCheck =
  | { ok: true; recomputed_hash: string; recomputed_id: string }
  | { ok: false; code: string; message: string };

/** Recompute hash + id from a record's content fields and compare. Pure function. */
export function verifyIntegrity(record: EvidenceRecord): IntegrityCheck {
  const structural = validateRecord(record);
  if (!structural.ok) {
    return { ok: false, code: structural.code, message: structural.message };
  }
  const recomputed_hash = computeContentHash({
    kind: record.kind,
    subject: record.subject,
    observation: record.observation,
    source: record.source,
  });
  if (recomputed_hash !== record.content_hash) {
    return {
      ok: false,
      code: "EVIDENCE_HASH_MISMATCH",
      message: `stored content_hash ${record.content_hash} != recomputed ${recomputed_hash}`,
    };
  }
  const recomputed_id = deriveEvidenceId(recomputed_hash);
  if (recomputed_id !== record.evidence_id) {
    return {
      ok: false,
      code: "EVIDENCE_ID_MISMATCH",
      message: `stored evidence_id ${record.evidence_id} != recomputed ${recomputed_id}`,
    };
  }
  return { ok: true, recomputed_hash, recomputed_id };
}
