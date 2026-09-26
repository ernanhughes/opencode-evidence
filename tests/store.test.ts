import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { buildRecord } from "../src/capture";
import { EvidenceStore } from "../src/store";

function freshStore(): EvidenceStore {
  return new EvidenceStore(mkdtempSync(join(tmpdir(), "ev-store-")));
}

function sampleRecord(subject = "s") {
  return buildRecord({
    kind: "structured_observation",
    subject,
    observation: { n: 1 },
    source: { kind: "caller" },
  });
}

describe("evidence store", () => {
  test("round-trips a record byte-identically", () => {
    const store = freshStore();
    const record = sampleRecord();
    const put = store.put(record);
    expect(put.duplicate).toBe(false);
    const fetched = store.get(record.evidence_id);
    expect(fetched).toEqual(record);
  });

  test("storing the same record twice is idempotent", () => {
    const store = freshStore();
    const record = sampleRecord();
    store.put(record);
    const again = store.put(record);
    expect(again.duplicate).toBe(true);
    expect(store.get(record.evidence_id)).toEqual(record);
  });

  test("a different record under the same id fails loudly", () => {
    const store = freshStore();
    const record = sampleRecord();
    store.put(record);
    // Corrupt the file in place to simulate a same-id divergence.
    const path = store.recordPath(record.evidence_id);
    const tampered = { ...record, observation: { n: "tampered" } };
    writeFileSync(path, JSON.stringify(tampered), "utf8");
    expect(() => store.put(record)).toThrow("EVIDENCE_ID_COLLISION");
  });

  test("malformed JSON on disk fails clearly", () => {
    const store = freshStore();
    const id = `ev_${"a".repeat(32)}`;
    mkdirSync(store.recordsDir(), { recursive: true });
    writeFileSync(join(store.recordsDir(), `${id}.json`), "{not json", "utf8");
    expect(() => store.get(id)).toThrow("EVIDENCE_MALFORMED");
  });

  test("schema-violating file fails clearly", () => {
    const store = freshStore();
    const id = `ev_${"b".repeat(32)}`;
    mkdirSync(store.recordsDir(), { recursive: true });
    writeFileSync(
      join(store.recordsDir(), `${id}.json`),
      JSON.stringify({ schema: "wrong", evidence_id: id }),
      "utf8",
    );
    expect(() => store.get(id)).toThrow("EVIDENCE_SCHEMA_MISMATCH");
  });

  test("unknown id fails as not-found", () => {
    const store = freshStore();
    expect(() => store.get(`ev_${"c".repeat(32)}`)).toThrow("EVIDENCE_NOT_FOUND");
  });

  test("malformed ids are rejected before touching disk", () => {
    const store = freshStore();
    for (const bad of ["", "ev_short", `EV_${"A".repeat(32)}`, `ev_${"z".repeat(32)}`]) {
      expect(() => store.get(bad)).toThrow("EVIDENCE_BAD_ID");
    }
  });

  test("retrieval is read-only (mtime + bytes unchanged)", () => {
    const store = freshStore();
    const record = sampleRecord();
    const path = store.put(record).path;
    const before = statSync(path);
    const bytesBefore = readFileSync(path, "utf8");
    store.get(record.evidence_id);
    store.get(record.evidence_id);
    const after = statSync(path);
    expect(readFileSync(path, "utf8")).toBe(bytesBefore);
    expect(after.mtimeMs).toBe(before.mtimeMs);
  });

  test("records carrying verdict fields are rejected on put", () => {
    const store = freshStore();
    const record = sampleRecord() as unknown as Record<string, unknown>;
    record["verified"] = true;
    expect(() => store.put(record as never)).toThrow("EVIDENCE_VERDICT_FIELD");
  });
});
