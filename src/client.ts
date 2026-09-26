import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildRecord,
  normalizeCommandResult,
  normalizeTestResult,
  observeFile,
  type CommandResultInput,
  type FileObservationOptions,
  type TestResultInput,
} from "./capture";
import { resolveStoreDir, type EvidenceConfig } from "./config";
import { verifyIntegrity } from "./identity";
import type { EvidenceKind, EvidenceRecord, EvidenceSource } from "./schema";
import { EvidenceStore } from "./store";
import { EVIDENCE_SCHEMA, PLUGIN_ID, PLUGIN_VERSION } from "./version";

export type { EvidenceRecord };

export class EvidenceClient {
  readonly store: EvidenceStore;
  readonly storeDir: string;

  constructor(
    readonly projectDir: string,
    overrides: EvidenceConfig = {},
  ) {
    this.storeDir = resolveStoreDir(projectDir, overrides);
    this.store = new EvidenceStore(this.storeDir);
  }

  recordStructured(
    kind: EvidenceKind,
    observation: unknown,
    opts: {
      subject?: string;
      source?: EvidenceSource;
      observed_at?: string;
      metadata?: Record<string, unknown>;
    } = {},
  ): { record: EvidenceRecord; path: string; duplicate: boolean } {
    const record = buildRecord({
      kind,
      ...(opts.subject !== undefined ? { subject: opts.subject } : {}),
      observation,
      source: opts.source ?? { kind: "caller" },
      ...(opts.observed_at !== undefined ? { observed_at: opts.observed_at } : {}),
      ...(opts.metadata !== undefined ? { metadata: opts.metadata } : {}),
    });
    const stored = this.store.put(record);
    return { record, path: stored.path, duplicate: stored.duplicate };
  }

  recordCommand(input: CommandResultInput): {
    record: EvidenceRecord;
    path: string;
    duplicate: boolean;
  } {
    const built = normalizeCommandResult(input);
    const record = buildRecord(built);
    const stored = this.store.put(record);
    return { record, path: stored.path, duplicate: stored.duplicate };
  }

  recordTest(input: TestResultInput): {
    record: EvidenceRecord;
    path: string;
    duplicate: boolean;
  } {
    const built = normalizeTestResult(input);
    const record = buildRecord(built);
    const stored = this.store.put(record);
    return { record, path: stored.path, duplicate: stored.duplicate };
  }

  recordFile(
    targetPath: string,
    opts: FileObservationOptions = {},
  ): { record: EvidenceRecord; path: string; duplicate: boolean } {
    const built = observeFile(this.projectDir, targetPath, opts);
    const record = buildRecord(built);
    const stored = this.store.put(record);
    return { record, path: stored.path, duplicate: stored.duplicate };
  }

  get(evidence_id: string): EvidenceRecord {
    return this.store.get(evidence_id);
  }

  /**
   * Explain a record's fields and provenance. Recomputes integrity.
   * States what the record does NOT establish.
   */
  explain(evidence_id: string): Record<string, unknown> {
    const record = this.store.get(evidence_id);
    const integrity = verifyIntegrity(record);
    return {
      evidence_id: record.evidence_id,
      schema: record.schema,
      kind: record.kind,
      fields: {
        subject: "optional label for what was observed; not an identity or claim.",
        observation: "the observed material itself. Data only — never a verdict.",
        source: "where the observation came from (kind + locator). Provenance, not authority.",
        observed_at: "when the observation was preserved. Does not affect identity.",
        content_hash: "sha256 over canonical { kind, subject, observation, source }.",
        evidence_id: "derived from content_hash. Same observation -> same id (idempotent).",
        producer: "which plugin version preserved this record. Not an endorser.",
        metadata: "optional caller-supplied annotations. Never verdicts.",
      },
      provenance: {
        source: record.source,
        observed_at: record.observed_at,
        producer: record.producer,
      },
      integrity:
        integrity.ok
          ? {
              stored_bytes_match: true,
              recomputed_hash: integrity.recomputed_hash,
              recomputed_id: integrity.recomputed_id,
            }
          : { stored_bytes_match: false, code: integrity.code, message: integrity.message },
      does_not_establish: [
        "whether the observation is true (hash integrity != truth);",
        "whether the source is trustworthy;",
        "whether any claim is proved (observation != verification);",
        "whether a task succeeded (e.g. exit_code 0 is data, not task success);",
        "whether any action may now execute.",
      ],
    };
  }

  /**
   * Readiness probe. Pure runtime checks only — no model inference exists
   * anywhere in this plugin, so there is nothing to invoke.
   */
  doctor(): Record<string, unknown> {
    let store_writable = false;
    let message: string | undefined;
    try {
      mkdirSync(join(this.storeDir, "records"), { recursive: true });
      const probe = join(this.storeDir, "records", ".write-probe");
      writeFileSync(probe, "ok", "utf8");
      unlinkSync(probe);
      store_writable = true;
    } catch (error) {
      message = `store not writable: ${String(error).slice(0, 200)}`;
    }
    const ok = store_writable;
    return {
      ok,
      plugin: PLUGIN_ID,
      version: PLUGIN_VERSION,
      schema: EVIDENCE_SCHEMA,
      store_dir: this.storeDir,
      store_writable,
      model_inference: "none",
      node: process.version,
      ...(message !== undefined ? { message } : {}),
    };
  }
}
