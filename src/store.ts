import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { prettyCanonical } from "./canonical";
import { verifyIntegrity } from "./identity";
import type { EvidenceRecord } from "./schema";
import { EVIDENCE_ID_PATTERN, validateRecord } from "./schema";

/** Largest stored record file we will read or write (1 MiB). */
export const MAX_RECORD_BYTES = 1_048_576;

export function assertValidId(evidence_id: string): void {
  if (typeof evidence_id !== "string" || !EVIDENCE_ID_PATTERN.test(evidence_id)) {
    throw new Error("EVIDENCE_BAD_ID: evidence_id must match /^ev_[0-9a-f]{32}$/");
  }
}

export class EvidenceStore {
  constructor(readonly dir: string) {}

  recordsDir(): string {
    return join(this.dir, "records");
  }

  recordPath(evidence_id: string): string {
    assertValidId(evidence_id);
    return join(this.recordsDir(), `${evidence_id}.json`);
  }

  /**
   * Persist a record. Atomic (tmp file + rename). Idempotent: storing the
   * byte-identical record twice succeeds with duplicate: true. A different
   * record under the same id fails loudly (EVIDENCE_ID_COLLISION) — never
   * a silent overwrite.
   */
  put(record: EvidenceRecord): { evidence_id: string; path: string; duplicate: boolean } {
    const structural = validateRecord(record);
    if (!structural.ok) {
      throw new Error(`${structural.code}: ${structural.message}`);
    }
    const integrity = verifyIntegrity(record);
    if (!integrity.ok) {
      throw new Error(`${integrity.code}: ${integrity.message}`);
    }
    const serialized = prettyCanonical(record);
    if (serialized.length > MAX_RECORD_BYTES) {
      throw new Error(`EVIDENCE_TOO_LARGE: record is ${serialized.length} bytes (cap ${MAX_RECORD_BYTES})`);
    }
    mkdirSync(this.recordsDir(), { recursive: true });
    const dest = this.recordPath(record.evidence_id);
    let existing: Buffer | null = null;
    try {
      existing = readFileSync(dest);
    } catch {
      existing = null;
    }
    if (existing !== null) {
      if (existing.toString("utf8") === serialized) {
        return { evidence_id: record.evidence_id, path: dest, duplicate: true };
      }
      throw new Error(
        `EVIDENCE_ID_COLLISION: ${dest} already holds a different record under ${record.evidence_id}`,
      );
    }
    const tmp = join(
      this.recordsDir(),
      `.tmp-${record.evidence_id}-${process.pid}-${Date.now()}.json`,
    );
    writeFileSync(tmp, serialized, "utf8");
    renameSync(tmp, dest);
    return { evidence_id: record.evidence_id, path: dest, duplicate: false };
  }

  /** Retrieve by id. Read-only: opens for reading, never mutates the record. */
  get(evidence_id: string): EvidenceRecord {
    assertValidId(evidence_id);
    const dest = this.recordPath(evidence_id);
    let stat: ReturnType<typeof statSync>;
    try {
      stat = statSync(dest);
    } catch {
      throw new Error(`EVIDENCE_NOT_FOUND: no record for ${evidence_id}`);
    }
    if (stat.size > MAX_RECORD_BYTES) {
      throw new Error(`EVIDENCE_TOO_LARGE: stored file is ${stat.size} bytes`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(dest, "utf8"));
    } catch {
      throw new Error(`EVIDENCE_MALFORMED: ${dest} is not valid JSON`);
    }
    const structural = validateRecord(parsed);
    if (!structural.ok) {
      throw new Error(`${structural.code}: ${structural.message} (${dest})`);
    }
    return structural.record;
  }
}
