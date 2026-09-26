import { Plugin } from "@opencode/plugin";
import type { Info as ToolInfo } from "@opencode/plugin/promise/tool";
import { EvidenceClient } from "./client";
import {
  EvidenceCommandTool,
  EvidenceExplainTool,
  EvidenceFileTool,
  EvidenceGetTool,
  EvidenceHealthTool,
  EvidenceRecordTool,
} from "./tools";

const EvidencePlugin = Plugin.define({
  id: "opencode-evidence",

  async setup(ctx) {
    const directory = ctx.location.directory;
    const client = new EvidenceClient(directory);

    try {
      const health = client.doctor();
      if (!health["ok"]) {
        console.warn(
          `[opencode-evidence] store not ready: ${String(health["message"] ?? "see evidence_health")}`,
        );
      }
    } catch (error) {
      console.warn(`[opencode-evidence] unavailable at startup: ${String(error).slice(0, 300)}`);
    }

    const tools: ToolInfo[] = [
      EvidenceRecordTool(client),
      EvidenceCommandTool(client),
      EvidenceFileTool(client),
      EvidenceGetTool(client),
      EvidenceExplainTool(client),
      EvidenceHealthTool(client),
    ];

    await ctx.tool.transform((editor) => {
      for (const tool of tools) editor.add(tool);
    });
  },
});

export default EvidencePlugin;
