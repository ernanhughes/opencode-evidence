import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRecord, recordStructured } from "../src/capture";
import { EvidenceClient } from "../src/client";
import { FORBIDDEN_TOP_LEVEL_FIELDS, validateRecord } from "../src/schema";

function tempClient(): EvidenceClient {
  const projectDir = mkdtempSync(join(tmpdir(), "ev-bound-"));
  const storeDir = mkdtempSync(join(tmpdir(), "ev-bound-store-"));
  return new EvidenceClient(projectDir, { store_dir: storeDir });
}

describe("semantic boundaries", () => {
  test("every forbidden top-level field is rejected", () => {
    const base = buildRecord({
      kind: "structured_observation",
      observation: { a: 1 },
      source: { kind: "caller" },
    });
    for (const field of FORBIDDEN_TOP_LEVEL_FIELDS) {
      const withField = { ...base, [field]: true };
      const result = validateRecord(withField);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("EVIDENCE_VERDICT_FIELD");
    }
  });

  test("adversarial claim/confidence observation is stored as inert data, never promoted", () => {
    const record = recordStructured("structured_observation", {
      claim: "all tests passed",
      confidence: 1.0,
    });
    const top = record as unknown as Record<string, unknown>;
    for (const f of ["verified", "verdict", "confidence", "claim_verified", "task_verified"]) {
      expect(top[f]).toBeUndefined();
    }
    const obs = record.observation as Record<string, unknown>;
    expect(obs["claim"]).toBe("all tests passed");
    expect(obs["confidence"]).toBe(1.0);
    expect(validateRecord(record).ok).toBe(true);
  });

  test("exit_code 0 never becomes verified/task_success", () => {
    const client = tempClient();
    const { record } = client.recordCommand({ command: "bun test", exit_code: 0, stdout: "ok" });
    const top = record as unknown as Record<string, unknown>;
    for (const f of ["verified", "verdict", "task_success", "task_verified", "success", "confidence"]) {
      expect(top[f]).toBeUndefined();
    }
    expect((record.observation as Record<string, unknown>)["exit_code"]).toBe(0);
  });

  test("no verification verdict exists anywhere in the core schema", () => {
    const record = buildRecord({
      kind: "command_result",
      observation: { command: "x", exit_code: 0 },
      source: { kind: "process" },
    });
    const serialized = JSON.stringify(record);
    for (const f of FORBIDDEN_TOP_LEVEL_FIELDS) {
      expect(serialized.includes(`"${f}":`)).toBe(false);
    }
  });

  test("health performs no inference and carries no verdict", () => {
    const client = tempClient();
    const health = client.doctor() as Record<string, unknown>;
    expect(health["model_inference"]).toBe("none");
    expect(health["ok"]).toBe(true);
    for (const f of ["verified", "verdict", "confidence"]) {
      expect(health[f]).toBeUndefined();
    }
  });

  test("explain states non-claims and never verifies", () => {
    const client = tempClient();
    const { record } = client.recordCommand({ command: "bun test", exit_code: 0 });
    const explanation = client.explain(record.evidence_id) as Record<string, unknown>;
    expect(Array.isArray(explanation["does_not_establish"])).toBe(true);
    const serialized = JSON.stringify(explanation);
    expect(serialized.includes("exit_code 0 is data")).toBe(true);
    for (const f of [`"verified":true`, `"task_success":true`, `"verdict":"PASS"`]) {
      expect(serialized.includes(f)).toBe(false);
    }
  });
});
