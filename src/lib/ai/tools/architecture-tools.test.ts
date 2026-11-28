import { describe, expect, it } from "vitest";
import { commitToolOutcome, createTurnUndoLedger } from "@/lib/ai/loop/transaction";
import { readThreatModelText } from "@/lib/thf-validation";
import { serializeThreatModelYaml } from "@/lib/thf-yaml";
import { createDocumentStores } from "@/stores/document-stores";
import mcpTools from "../../../../src-tauri/src/mcp/fixtures/tool-surface.json";
import rawModel from "../../../../tests/fixtures/thf/architecture-canonical-full.thf?raw";
import { ARCHITECTURE_TOOLS } from "./architecture-tools";
import { createAiToolRegistry } from "./tool-registry";

const registry = createAiToolRegistry();

function prepare(name: string, input: unknown, review?: ReturnType<typeof readThreatModelText>) {
	const result = registry.get(name)?.prepare(input, review);
	if (!result?.ok) throw new Error(`Could not prepare ${name}: ${JSON.stringify(result)}`);
	return result.call;
}

describe("architecture mutation parity", () => {
	it("uses the same strict keys, required arguments, and nullable arguments as MCP", () => {
		const schema = mcpTools.find((tool) => tool.name === "batch_transaction")?.inputSchema;
		const definitions = schema?.$defs;
		const variants = definitions?.Mutation.oneOf;
		if (!variants || !definitions) throw new Error("Missing MCP mutation schema");
		const architectureNames = variants
			.map((variant) => variant.properties.tool.const)
			.filter((name) => /relationship|group|layer/.test(name));
		expect(ARCHITECTURE_TOOLS.map((tool) => tool.name).sort()).toEqual(architectureNames.sort());

		for (const tool of ARCHITECTURE_TOOLS) {
			const variant = variants.find((entry) => entry.properties.tool.const === tool.name);
			const reference = variant?.properties.arguments?.$ref?.split("/").pop();
			const args = Object.entries(definitions).find(([name]) => name === reference)?.[1];
			if (!args || !("properties" in args) || !("required" in args)) {
				throw new Error(`Missing MCP argument schema for ${tool.name}`);
			}
			const provider = tool.jsonSchema();
			expect(provider.additionalProperties).toBe(false);
			expect(Object.keys(provider.properties).sort()).toEqual(Object.keys(args.properties).sort());
			expect(provider.required?.slice().sort()).toEqual(args.required.slice().sort());
			const containsNull = (field: unknown): boolean => {
				if (
					typeof field === "object" &&
					field !== null &&
					"$ref" in field &&
					typeof field.$ref === "string"
				) {
					const name = field.$ref.split("/").pop();
					return containsNull(Object.entries(definitions).find(([key]) => key === name)?.[1]);
				}
				return /"null"/.test(JSON.stringify(field));
			};
			expect(
				Object.entries(provider.properties)
					.filter(([, field]) => containsNull(field))
					.map(([key]) => key)
					.sort(),
			).toEqual(
				Object.entries(args.properties)
					.filter(([, field]) => containsNull(field))
					.map(([key]) => key)
					.sort(),
			);
			expect(tool.destructive).toBe(tool.name.startsWith("delete_"));
		}
	});

	it("reconnects a relationship without losing other fields on save and rejects invalid group edits", async () => {
		const original = readThreatModelText(rawModel);
		const relationship = original.relationships?.[0];
		if (!relationship) throw new Error("The fixture has no relationships");
		const model = {
			...original,
			relationships: [{ ...relationship, target_handle: "left", extension: { keep: true } }],
		};
		const stores = createDocumentStores();
		stores.model.getState().setModel(model, null);
		const signal = new AbortController().signal;
		const ledger = createTurnUndoLedger();
		const target = model.elements.find((element) => element.id !== relationship.to);
		if (!target) throw new Error("No alternate endpoint");
		const expected = stores.model.getState().model;
		if (!expected) throw new Error("No active fixture");
		const call = prepare("update_relationship", { id: relationship.id, to: target.id });
		const outcome = await call.run({ document: expected, signal });
		const result = commitToolOutcome(outcome, { expected, effect: "mutate", ledger }, stores);
		expect(result.status).toBe("committed");
		expect(JSON.parse(result.result)).toEqual({
			action: "update_relationship",
			id: relationship.id,
		});
		const next = stores.model.getState().model;
		if (!next) throw new Error("No edited fixture");
		const reopened = readThreatModelText(serializeThreatModelYaml(next));
		expect(reopened.relationships?.[0]).toMatchObject({ to: target.id, extension: { keep: true } });
		expect(reopened.relationships?.[0]?.target_handle).toBeUndefined();
		expect(reopened.data_flows).toEqual(original.data_flows);
		expect(reopened.version).toBe("1.0");

		const cycle = prepare("reparent_group", { id: "backend-cluster", parent: "api-subcluster" });
		const refused = commitToolOutcome(
			await cycle.run({ document: next, signal }),
			{
				expected: next,
				effect: "mutate",
				ledger,
			},
			stores,
		);
		expect(refused).toMatchObject({ status: "refused", refusal: "invalid_document" });
		expect(refused.result).toContain("Circular group nesting");
		expect(stores.model.getState().model).toBe(next);
		expect(registry.get("set_element_group")?.prepare({ id: target.id })).toMatchObject({
			ok: false,
		});

		const occupied = prepare("delete_group", { id: "backend-cluster" }, next);
		expect(await occupied.run({ document: next, signal })).toMatchObject({
			status: "error",
			result: expect.stringContaining("still has"),
		});
		const deletion = prepare("delete_relationship", { id: relationship.id }, next);
		const changed = {
			...next,
			relationships: [{ ...relationship, description: "Edited after review" }],
		};
		expect(await deletion.run({ document: changed, signal })).toMatchObject({
			status: "error",
			result: expect.stringContaining("changed after"),
		});
	});

	it("clears explicit null metadata, preserves omitted values, and refuses null on required fields", async () => {
		const document = readThreatModelText(rawModel);
		const relationship = document.relationships?.find((item) => item.stroke_color != null);
		if (!relationship) throw new Error("No styled relationship");
		const signal = new AbortController().signal;
		const call = prepare("update_relationship", { id: relationship.id, stroke_color: null });
		expect(call.summary).toContain("stroke color: none");
		const outcome = await call.run({ document, signal });
		expect(outcome.status).toBe("ok");
		if (outcome.status !== "ok" || !outcome.document) throw new Error("No updated document");
		const reopened = readThreatModelText(serializeThreatModelYaml(outcome.document));
		expect(reopened.relationships?.find((item) => item.id === relationship.id)).toEqual({
			...relationship,
			stroke_color: undefined,
		});

		for (const [tool, id] of [
			["update_group", "backend-cluster"],
			["update_layer", "application"],
		]) {
			const reset = prepare(tool, { id, description: null });
			const result = await reset.run({ document, signal });
			if (result.status !== "ok" || !result.document) throw new Error("No updated document");
			const section = tool === "update_group" ? result.document.groups : result.document.layers;
			expect(section?.find((item) => item.id === id)?.description).toBeUndefined();
			expect(registry.get(tool)?.prepare({ id, name: null })).toMatchObject({ ok: false });
		}
	});
});
