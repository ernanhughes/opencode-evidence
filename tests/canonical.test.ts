import { describe, expect, test } from "bun:test";
import { canonicalize } from "../src/canonical";

describe("canonicalization", () => {
  test("sorts object keys recursively", () => {
    const a = canonicalize({ z: 1, a: { d: 4, c: 3 }, m: [3, 2] });
    const b = canonicalize({ m: [3, 2], a: { c: 3, d: 4 }, z: 1 });
    expect(a).toBe(b);
    expect(a).toBe(`{"a":{"c":3,"d":4},"m":[3,2],"z":1}`);
  });

  test("is deterministic across runs for the same value", () => {
    const v = { kind: "x", observation: { n: 1, s: "t", arr: [true, null] } };
    expect(canonicalize(v)).toBe(canonicalize(JSON.parse(JSON.stringify(v))));
  });

  test("drops undefined object properties (JSON semantics)", () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe(`{"a":1}`);
  });

  test("maps undefined array items to null (JSON semantics)", () => {
    expect(canonicalize([1, undefined])).toBe(`[1,null]`);
  });

  test("maps non-finite numbers to null (JSON semantics)", () => {
    expect(canonicalize({ a: NaN, b: Infinity })).toBe(`{"a":null,"b":null}`);
  });

  test("serializes Date as ISO string", () => {
    expect(canonicalize({ t: new Date("2026-01-02T03:04:05.000Z") })).toBe(
      `{"t":"2026-01-02T03:04:05.000Z"}`,
    );
  });

  test("rejects bigint, function, symbol", () => {
    expect(() => canonicalize({ v: 1n })).toThrow("EVIDENCE_NON_JSON_VALUE");
    expect(() => canonicalize({ v: () => {} })).toThrow("EVIDENCE_NON_JSON_VALUE");
    expect(() => canonicalize({ v: Symbol("s") })).toThrow("EVIDENCE_NON_JSON_VALUE");
  });

  test("array order is significant", () => {
    expect(canonicalize([1, 2])).not.toBe(canonicalize([2, 1]));
  });
});
