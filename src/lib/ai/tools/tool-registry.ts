import {
	createToolRegistry,
	type RegisteredTool,
	type ToolRegistry,
} from "@/lib/ai/loop/tool-runtime";
import { ARCHITECTURE_TOOLS } from "@/lib/ai/tools/architecture-tools";
import { CATALOG_READ_TOOL } from "@/lib/ai/tools/catalog-read-tool";
import { DOCUMENT_READ_TOOLS } from "@/lib/ai/tools/document-read-tools";
import { GRAPH_ACTION_TOOLS } from "@/lib/ai/tools/graph-action-tools";

/** Every `effect: "read"` tool offered to a tool-capable model, in advertised order. */
export const READ_TOOLS: readonly RegisteredTool[] = [...DOCUMENT_READ_TOOLS, CATALOG_READ_TOOL];

/** The production tool set, with read tools first. */
export function createAiToolRegistry(): ToolRegistry {
	return createToolRegistry([...READ_TOOLS, ...GRAPH_ACTION_TOOLS, ...ARCHITECTURE_TOOLS]);
}
