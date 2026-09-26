import { EVIDENCE_SCHEMA, PLUGIN_ID } from "./version";

export type EvidenceKind =
  | "command_result"
  | "file_observation"
  | "test_result"
  | "http_observation"
  | "git_observation"
  | "structured_observation"
  | "other";

export const EVIDENCE_KINDS: readonly EvidenceKind[] = [
  "command_result",
  "file_observation",
  "test_result",
  "http_observation",
  "git_observation",
  "structured_observation",
  "other",
];

export type EvidenceSource = {
  kind: string;
  locator?: string;
  version?: string;
};

export type EvidenceProducer = {
  plugin: typeof PLUGIN_ID;
  version: string;
};

export type EvidenceRecord = {
  schema: typeof EVIDENCE_SCHEMA;
  evidence_id: string;
  kind: EvidenceKind;
  subject?: string;
  observation: unknown;
  source: EvidenceSource;
  observed_at: string;
  content_hash: string;
  producer: EvidenceProducer;
  metadata?: Record<string, unknown>;
};

/**
 * Top-level fields that would turn an observation into a verdict.
 * They are forbidden on EvidenceRecord itself. Caller-supplied data nested
 * inside `observation` or `metadata` may contain such words as inert data;
 * the core never reads them as verdicts.
 */
export const FORBIDDEN_TOP_LEVEL_FIELDS: readonly string[] = [
  "verified",
  "verdict",
  "confidence",
  "trust_score",
  "claim_verified",
  "task_verified",
  "task_success",
  "proves",
  "proof",
  "valid",
  "success",
];

export const EVIDENCE_ID_PATTERN = /^ev_[0-9a-f]{32}$/;
export const CONTENT_HASH_PATTERN = /^[0-9a-f]{64}$/;

export function isEvidenceKind(value: unknown): value is EvidenceKind {
  return (
    typeof value === "string" &&
    (EVIDENCE_KINDS as readonly string[]).includes(value)
  );
}

export type RecordValidation =
  | { ok: true; record: EvidenceRecord }
  | { ok: false; code: string; message: string };

function fail(code: string, message: string): RecordValidation {
  return { ok: false, code, message };
}

/** Structural validation of a parsed record. Never fetches, infers, or judges. */
export function validateRecord(parsed: unknown): RecordValidation {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return fail("EVIDENCE_MALFORMED", "record must be a JSON object");
  }
  const rec = parsed as Record<string, unknown>;

  for (const field of FORBIDDEN_TOP_LEVEL_FIELDS) {
    if (rec[field] !== undefined) {
      return fail(
        "EVIDENCE_VERDICT_FIELD",
        `record must not carry top-level verdict field "${field}"`,
      );
    }
  }

  if (rec["schema"] !== EVIDENCE_SCHEMA) {
    return fail(
      "EVIDENCE_SCHEMA_MISMATCH",
      `record schema must be "${EVIDENCE_SCHEMA}"`,
    );
  }
  if (typeof rec["evidence_id"] !== "string" || !EVIDENCE_ID_PATTERN.test(rec["evidence_id"])) {
    return fail("EVIDENCE_BAD_ID", "evidence_id must match /^ev_[0-9a-f]{32}$/");
  }
  if (!isEvidenceKind(rec["kind"])) {
    return fail(
      "EVIDENCE_BAD_KIND",
      `kind must be one of: ${EVIDENCE_KINDS.join(", ")}`,
    );
  }
  if (rec["subject"] !== undefined && typeof rec["subject"] !== "string") {
    return fail("EVIDENCE_BAD_SUBJECT", "subject must be a string when present");
  }
  if (rec["observation"] === undefined) {
    return fail("EVIDENCE_MISSING_OBSERVATION", "observation must be present");
  }
  const source = rec["source"];
  if (typeof source !== "object" || source === null || Array.isArray(source)) {
    return fail("EVIDENCE_BAD_SOURCE", "source must be an object");
  }
  const src = source as Record<string, unknown>;
  if (typeof src["kind"] !== "string" || src["kind"].length === 0) {
    return fail("EVIDENCE_BAD_SOURCE", "source.kind must be a non-empty string");
  }
  if (src["locator"] !== undefined && typeof src["locator"] !== "string") {
    return fail("EVIDENCE_BAD_SOURCE", "source.locator must be a string when present");
  }
  if (src["version"] !== undefined && typeof src["version"] !== "string") {
    return fail("EVIDENCE_BAD_SOURCE", "source.version must be a string when present");
  }
  if (typeof rec["observed_at"] !== "string" || Number.isNaN(Date.parse(rec["observed_at"]))) {
    return fail("EVIDENCE_BAD_TIME", "observed_at must be a parseable timestamp string");
  }
  if (typeof rec["content_hash"] !== "string" || !CONTENT_HASH_PATTERN.test(rec["content_hash"])) {
    return fail("EVIDENCE_BAD_HASH", "content_hash must be 64 lowercase hex chars");
  }
  const producer = rec["producer"];
  if (typeof producer !== "object" || producer === null || Array.isArray(producer)) {
    return fail("EVIDENCE_BAD_PRODUCER", "producer must be an object");
  }
  const prod = producer as Record<string, unknown>;
  if (prod["plugin"] !== PLUGIN_ID) {
    return fail("EVIDENCE_BAD_PRODUCER", `producer.plugin must be "${PLUGIN_ID}"`);
  }
  if (typeof prod["version"] !== "string" || prod["version"].length === 0) {
    return fail("EVIDENCE_BAD_PRODUCER", "producer.version must be a non-empty string");
  }
  if (
    rec["metadata"] !== undefined &&
    (typeof rec["metadata"] !== "object" || rec["metadata"] === null || Array.isArray(rec["metadata"]))
  ) {
    return fail("EVIDENCE_BAD_METADATA", "metadata must be an object when present");
  }
  return { ok: true, record: parsed as EvidenceRecord };
}
