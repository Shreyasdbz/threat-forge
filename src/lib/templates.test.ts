import { describe, expect, it } from "vitest";
import { resolveElementIcon } from "@/lib/registry/registry";
import { analyzeStride } from "@/lib/stride-engine";
import { ARCHITECTURE_STARTERS, loadTemplate } from "@/lib/templates";
import { readThreatModelText } from "@/lib/thf-validation";
import { serializeThreatModelYaml } from "@/lib/thf-yaml";

describe("architecture starters", () => {
	it.each(ARCHITECTURE_STARTERS)(
		"opens and round-trips $name without findings",
		({ id, source }) => {
			const fixture = readThreatModelText(source);
			const model = loadTemplate(id);
			if (!model) throw new Error(`Missing starter: ${id}`);
			expect(model).toEqual({
				...fixture,
				metadata: {
					...fixture.metadata,
					created: model.metadata.created,
					modified: model.metadata.modified,
				},
			});
			expect(model.threats).toEqual([]);
			expect(model.layers).toHaveLength(2);
			expect(model.groups).toHaveLength(1);
			expect(model.relationships).toHaveLength(1);
			expect(model.elements.filter((element) => element.type === "text")).toHaveLength(1);
			expect(
				new Set(model.elements.map((element) => resolveElementIcon(element).id)).size,
			).toBeGreaterThan(1);
			expect(readThreatModelText(serializeThreatModelYaml(model))).toEqual(model);
			expect(analyzeStride(model).length).toBeGreaterThan(0);
			expect(model.threats).toEqual([]);
		},
	);
});
