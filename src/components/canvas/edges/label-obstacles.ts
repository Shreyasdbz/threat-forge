import type { DfdNode } from "@/lib/canvas-projection";
import { nodeToRect } from "@/lib/canvas-utils";

export type NodeRect = ReturnType<typeof nodeToRect>;

const projections = new WeakMap<
	readonly DfdNode[],
	{ byId: ReadonlyMap<string, NodeRect>; obstacles: readonly NodeRect[] }
>();

export function getLabelObstacles(nodes: readonly DfdNode[]) {
	const existing = projections.get(nodes);
	if (existing) return existing;

	const nodesById = new Map(nodes.map((node) => [node.id, node]));
	const byId = new Map<string, NodeRect>();
	for (const node of nodes) {
		if (node.data.isBoundary || node.type === "architectureGroup") continue;
		const rect = nodeToRect(node);
		const parent = node.parentId ? nodesById.get(node.parentId) : undefined;
		byId.set(
			node.id,
			parent ? { ...rect, x: rect.x + parent.position.x, y: rect.y + parent.position.y } : rect,
		);
	}
	const geometry = { byId, obstacles: [...byId.values()] };
	projections.set(nodes, geometry);
	return geometry;
}
