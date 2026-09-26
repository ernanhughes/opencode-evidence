import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EvidenceClient } from "../src/client";
import plugin from "../src/plugin";
import {
  EvidenceCommandTool,
  EvidenceExplainTool,
  EvidenceFileTool,
  EvidenceGetTool,
  EvidenceHealthTool,
  EvidenceRecordTool,
  EVIDENCE_TOOL_NAMES,
} from "../src/tools";

function tempClient(): EvidenceClient {
  const projectDir = mkdtempSync(join(tmpdir(), "ev-plugin-"));
  const storeDir = mkdtempSync(join(tmpdir(), "ev-plugin-store-"));
  return new EvidenceClient(projectDir, { store_dir: storeDir });
}

describe("plugin load", () => {
  test("setup registers exactly the six expected tools", async () => {
    const added: string[] = [];
    const fakeCtx = {
      location: { directory: mkdtempSync(join(tmpdir(), "ev-fakectx-")) },
      tool: {
        transform: async (fn: (editor: { add: (t: { name: string }) => void }) => void) => {
          fn({ add: (t) => void added.push(t.name) });
        },
      },
      session: { hook: async () => {} },
    };
    await (plugin as { setup: (ctx: unknown) => Promise<void> }).setup(fakeCtx);
    expect(added).toEqual([...EVIDENCE_TOOL_NAMES]);
  });
});

describe("agent-facing tools", () => {
  test("evidence_health reports readiness without inference", async () => {
    const tool = EvidenceHealthTool(tempClient());
    expect(tool.name).toBe("evidence_health");
    const out = JSON.parse(
      (await tool.execute({}, {} as never))!.content as unknown as string,
    ) as Record<string, unknown>;
    expect(out["ok"]).toBe(true);
    expect(out["model_inference"]).toBe("none");
  });

  test("evidence_record -> evidence_get round-trip", async () => {
    const client = tempClient();
    const created = JSON.parse(
      (await EvidenceRecordTool(client).execute(
        { kind: "structured_observation", subject: "s", observation: { a: 1 } },
        {} as never,
      ))!.content as unknown as string,
    ) as { ok: boolean; record: { evidence_id: string } };
    expect(created.ok).toBe(true);
    const fetched = JSON.parse(
      (await EvidenceGetTool(client).execute(
        { evidence_id: created.record.evidence_id },
        {} as never,
      ))!.content as unknown as string,
    ) as { ok: boolean; record: { evidence_id: string } };
    expect(fetched.ok).toBe(true);
    expect(fetched.record.evidence_id).toBe(created.record.evidence_id);
  });

  test("evidence_command wraps observed results without executing", async () => {
    const client = tempClient();
    const created = JSON.parse(
      (await EvidenceCommandTool(client).execute(
        { command: "bun test", exit_code: 0, stdout: "43 passed" },
        {} as never,
      ))!.content as unknown as string,
    ) as { ok: boolean; record: { kind: string; observation: Record<string, unknown> } };
    expect(created.ok).toBe(true);
    expect(created.record.kind).toBe("command_result");
    expect(created.record.observation["exit_code"]).toBe(0);
  });

  test("evidence_file observes and evidence_explain explains", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "ev-filetool-"));
    const storeDir = mkdtempSync(join(tmpdir(), "ev-filetool-store-"));
    writeFileSync(join(projectDir, "note.txt"), "hello", "utf8");
    const client = new EvidenceClient(projectDir, { store_dir: storeDir });
    const created = JSON.parse(
      (await EvidenceFileTool(client).execute({ path: "note.txt" }, {} as never))!
        .content as unknown as string,
    ) as { ok: boolean; record: { evidence_id: string } };
    expect(created.ok).toBe(true);
    const explained = JSON.parse(
      (await EvidenceExplainTool(client).execute(
        { evidence_id: created.record.evidence_id },
        {} as never,
      ))!.content as unknown as string,
    ) as { ok: boolean; explanation: { evidence_id: string } };
    expect(explained.ok).toBe(true);
    expect(explained.explanation.evidence_id).toBe(created.record.evidence_id);
  });

  test("evidence_get on unknown id returns ok:false, not a throw", async () => {
    const client = tempClient();
    const out = JSON.parse(
      (await EvidenceGetTool(client).execute(
        { evidence_id: `ev_${"d".repeat(32)}` },
        {} as never,
      ))!.content as unknown as string,
    ) as { ok: boolean; error: string };
    expect(out.ok).toBe(false);
    expect(out.error).toContain("EVIDENCE_NOT_FOUND");
  });
});
