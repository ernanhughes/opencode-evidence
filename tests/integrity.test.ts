import { describe, expect, test } from "bun:test";
import { buildRecord } from "../src/capture";
import { computeContentHash, deriveEvidenceId, verifyIntegrity } from "../src/identity";

function sample() {
  return {
    kind: "structured_observation" as const,
    subject: "s",
    observation: { b: 2, a: 1 },
    source: { kind: "caller" as const },
  };
}

describe("identity and integrity", () => {
  test("identical observations produce stable content identity", () => {
    const r1 = buildRecord({ ...sample(), observed_at: "2026-01-01T00:00:00.000Z" });
    const r2 = buildRecord({ ...sample(), observed_at: "2026-06-01T00:00:00.000Z" });
    expect(r1.content_hash).toBe(r2.content_hash);
    expect(r1.evidence_id).toBe(r2.evidence_id);
  });

  test("producer version and observed_at do not affect identity", () => {
    const r1 = buildRecord({ ...sample(), producerVersion: "0.1.0" });
    const r2 = buildRecord({ ...sample(), producerVersion: "9.9.9" });
    expect(r1.evidence_id).toBe(r2.evidence_id);
  });

  test("changed observation changes content hash and id", () => {
    const r1 = buildRecord(sample());
    const r2 = buildRecord({ ...sample(), observation: { b: 2, a: 999 } });
    expect(r1.content_hash).not.toBe(r2.content_hash);
    expect(r1.evidence_id).not.toBe(r2.evidence_id);
  });

  test("changed source changes identity; key order does not", () => {
    const r1 = buildRecord(sample());
    const r2 = buildRecord({ ...sample(), source: { kind: "caller", locator: "elsewhere" } });
    expect(r1.evidence_id).not.toBe(r2.evidence_id);
    const r3 = buildRecord({ ...sample(), observation: { a: 1, b: 2 } });
    expect(r1.evidence_id).toBe(r3.evidence_id);
  });

  test("verifyIntegrity accepts a fresh record", () => {
    const r = buildRecord(sample());
    const check = verifyIntegrity(r);
    expect(check.ok).toBe(true);
  });

  test("verifyIntegrity rejects tampered observation", () => {
    const r = buildRecord(sample());
    const tampered = { ...r, observation: { b: 2, a: "tampered" } };
    const check = verifyIntegrity(tampered);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.code).toBe("EVIDENCE_HASH_MISMATCH");
  });

  test("verifyIntegrity rejects tampered id", () => {
    const r = buildRecord(sample());
    const tampered = { ...r, evidence_id: "ev_00000000000000000000000000000000" };
    const check = verifyIntegrity(tampered);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.code).toBe("EVIDENCE_ID_MISMATCH");
  });

  test("id derives deterministically from hash", () => {
    const h = computeContentHash(sample());
    expect(deriveEvidenceId(h)).toBe(`ev_${h.slice(0, 32)}`);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});
