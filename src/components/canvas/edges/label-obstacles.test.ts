import { expect, it } from "vitest";
import type { DfdNode } from "@/lib/canvas-projection";
import { getLabelObstacles } from "./label-obstacles";

it("shares one obstacle projection across edges and responds to geometry changes", () => {
	const data = {
		label: "Service",
		elementType: "generic",
		trustZone: "",
		description: "",
		technologies: [],
	};
	const nodes: DfdNode[] = [
		{
			id: "boundary",
			position: { x: 10, y: 20 },
			data: { ...data, isBoundary: true },
		},
		{
			id: "service",
			parentId: "boundary",
			position: { x: 30, y: 40 },
			measured: { width: 60, height: 50 },
			data,
		},
	];
	const first = getLabelObstacles(nodes);
	expect(first.obstacles).toEqual([{ x: 40, y: 60, width: 60, height: 50 }]);
	expect(first.byId.get("service")).toBe(first.obstacles[0]);
	expect(getLabelObstacles(nodes)).toBe(first);

	const moved = [{ ...nodes[0], position: { x: 50, y: 30 } }, nodes[1]];
	expect(getLabelObstacles(moved).obstacles).toEqual([{ x: 80, y: 70, width: 60, height: 50 }]);
});
