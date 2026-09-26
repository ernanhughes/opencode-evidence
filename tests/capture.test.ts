import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildRecord,
  MAX_EXCERPT_BYTES,
  MAX_OBSERVATION_BYTES,
  MAX_OUTPUT_CHARS,
  normalizeCommandResult,
  normalizeTestResult,
  observeFile,
  recordStructured,
} from "../src/capture";

function tmpProject(): string {
  return mkdtempSync(join(tmpdir(), "ev-cap-"));
}

describe("command-result normalization", () => {
  test("preserves command, cwd, exit code, streams, times", () => {
    const built = normalizeCommandResult({
      command: "bun test",
      exit_code: 0,
      stdout: "42 passed",
      stderr: "",
      cwd: "/repo",
      started_at: "2026-01-01T00:00:00.000Z",
      ended_at: "2026-01-01T00:00:01.000Z",
      subject: "test-suite",
    });
    const record = buildRecord(built);
    expect(record.kind).toBe("command_result");
    const obs = record.observation as Record<string, unknown>;
    expect(obs["command"]).toBe("bun test");
    expect(obs["exit_code"]).toBe(0);
    expect(obs["stdout"]).toBe("42 passed");
    expect(obs["cwd"]).toBe("/repo");
    expect(obs["stdout_truncated"]).toBe(false);
  });

  test("exit_code 0 stays data; no success/verified field is added", () => {
    const record = buildRecord(normalizeCommandResult({ command: "true", exit_code: 0 }));
    const obs = record.observation as Record<string, unknown>;
    expect(obs["exit_code"]).toBe(0);
    for (const k of ["success", "successful", "verified", "verdict", "task_success"]) {
      expect(obs[k]).toBeUndefined();
      expect((record as Record<string, unknown>)[k]).toBeUndefined();
    }
  });

  test("long output is truncated with a flag, not silently cut", () => {
    const record = buildRecord(
      normalizeCommandResult({ command: "x", exit_code: 1, stdout: "o".repeat(MAX_OUTPUT_CHARS + 5) }),
    );
    const obs = record.observation as Record<string, unknown>;
    expect((obs["stdout"] as string).length).toBe(MAX_OUTPUT_CHARS);
    expect(obs["stdout_truncated"]).toBe(true);
  });

  test("rejects empty command and non-integer exit codes", () => {
    expect(() => normalizeCommandResult({ command: "", exit_code: 0 })).toThrow("EVIDENCE_BAD_COMMAND");
    expect(() => normalizeCommandResult({ command: "x", exit_code: 0.5 })).toThrow("EVIDENCE_BAD_EXIT_CODE");
  });
});

describe("test-result normalization", () => {
  test("preserves counts as data without a verdict", () => {
    const record = buildRecord(
      normalizeTestResult({ runner: "bun test", command: "bun test", exit_code: 0, passed: 43, failed: 0, skipped: 1 }),
    );
    expect(record.kind).toBe("test_result");
    const obs = record.observation as Record<string, unknown>;
    expect(obs["passed"]).toBe(43);
    expect(obs["failed"]).toBe(0);
    expect(obs["skipped"]).toBe(1);
    expect((record as Record<string, unknown>)["verified"]).toBeUndefined();
  });

  test("rejects non-numeric counts", () => {
    expect(() => normalizeTestResult({ passed: NaN })).toThrow("EVIDENCE_BAD_TEST_RESULT");
  });
});

describe("file observation", () => {
  test("records existence, size, hash, bounded excerpt", () => {
    const dir = tmpProject();
    writeFileSync(join(dir, "a.txt"), "hello world", "utf8");
    const record = buildRecord(observeFile(dir, "a.txt", { subject: "doc" }));
    expect(record.kind).toBe("file_observation");
    const obs = record.observation as Record<string, unknown>;
    expect(obs["exists"]).toBe(true);
    expect(obs["size"]).toBe(11);
    expect(typeof obs["file_hash"]).toBe("string");
    expect(obs["content_excerpt"]).toBe("hello world");
    expect(obs["excerpt_truncated"]).toBe(false);
  });

  test("bounds excerpts on large files with a truncation flag", () => {
    const dir = tmpProject();
    writeFileSync(join(dir, "big.bin"), "x".repeat(MAX_EXCERPT_BYTES + 100), "utf8");
    const record = buildRecord(observeFile(dir, "big.bin"));
    const obs = record.observation as Record<string, unknown>;
    expect((obs["content_excerpt"] as string).length).toBe(MAX_EXCERPT_BYTES);
    expect(obs["excerpt_truncated"]).toBe(true);
    expect(typeof obs["file_hash"]).toBe("string");
  });

  test("missing file is a valid exists:false observation", () => {
    const dir = tmpProject();
    const record = buildRecord(observeFile(dir, "nope.txt"));
    const obs = record.observation as Record<string, unknown>;
    expect(obs["exists"]).toBe(false);
    expect(obs["path"]).toBe("nope.txt");
  });

  test("directory observation has no file hash", () => {
    const dir = tmpProject();
    mkdirSync(join(dir, "sub"));
    const record = buildRecord(observeFile(dir, "sub"));
    const obs = record.observation as Record<string, unknown>;
    expect(obs["exists"]).toBe(true);
    expect(obs["is_directory"]).toBe(true);
    expect(obs["file_hash"]).toBeUndefined();
  });
});

describe("structured observation", () => {
  test("accepts JSON-like state and round-trips it", () => {
    const record = recordStructured("structured_observation", { nested: [1, 2], ok: true });
    expect(record.kind).toBe("structured_observation");
    expect(record.observation).toEqual({ nested: [1, 2], ok: true });
  });

  test("rejects oversized observations", () => {
    const big = "x".repeat(MAX_OBSERVATION_BYTES + 1);
    expect(() => recordStructured("structured_observation", { big })).toThrow("EVIDENCE_TOO_LARGE");
  });

  test("rejects non-JSON values", () => {
    expect(() => recordStructured("structured_observation", { v: 1n })).toThrow("EVIDENCE_NON_JSON_VALUE");
  });
});
