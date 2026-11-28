import { describe, expect, it } from "vitest";
import { sequenceDiagrams } from "@/lib/sequence-views";
import { readThreatModelText } from "@/lib/thf-validation";
import opaqueYaml from "../../tests/fixtures/thf/v1.0-opaque-sequence.thf?raw";
import typedYaml from "../../tests/fixtures/thf/v1.1-sequence.thf?raw";
import { createDocumentStores } from "./document-stores";

describe("sequence edits", () => {
	it("promotes an ordinary 1.0 document as one undo step", () => {
		const { model, history } = createDocumentStores();
		const typed = readThreatModelText(typedYaml);
		const before = { ...typed, version: "1.0", diagrams: [typed.diagrams[0]] };
		model.getState().setModel(before, null);
		expect(model.getState().editSequenceDiagrams(typed.diagrams)).toBe(true);
		expect(model.getState().model).toEqual(typed);
		expect(history.getState().past).toEqual([before]);
		expect(model.getState().editSequenceDiagrams(before.diagrams)).toBe(true);
		expect(model.getState().model?.version).toBe("1.1");
	});

	it("does not promote a native model with an opaque extension only in source YAML", () => {
		const { model, history } = createDocumentStores();
		const before = readThreatModelText(opaqueYaml);
		const [{ sequence: _sequence, ...diagram }] = before.diagrams;
		const projection = { ...before, diagrams: [diagram] };
		model.getState().setModel(projection, "/legacy.thf", "revision", opaqueYaml);
		expect(model.getState().editSequenceDiagrams(readThreatModelText(typedYaml).diagrams)).toBe(
			false,
		);
		expect(model.getState().model).toBe(projection);
		expect(model.getState().isDirty).toBe(false);
		expect(model.getState().sequenceError).toContain("diagrams[].sequence");
		expect(history.getState().past).toEqual([]);
	});

	it("refuses linked graph edits atomically until the explicit sequence references are removed", () => {
		const { model, canvas, history } = createDocumentStores();
		const before = readThreatModelText(typedYaml);
		model.getState().setModel(before, null);
		canvas.getState().syncFromModel();
		const edge = canvas.getState().edges.find(({ id }) => id === "submit");
		if (!edge) throw new Error("Missing fixture edge");
		canvas.getState().reverseEdge("submit");
		canvas.getState().reconnectEdge(edge, {
			source: "checkout",
			target: "customer",
			sourceHandle: null,
			targetHandle: null,
		});
		canvas.getState().onEdgesChange([{ type: "remove", id: "submit" }]);
		canvas.getState().onNodesChange([{ type: "select", id: "customer", selected: true }]);
		canvas.getState().deleteSelected();
		expect(canvas.getState().nodes.map(({ id }) => id)).toContain("customer");
		expect(canvas.getState().edges).toContain(edge);
		expect(model.getState().model).toBe(before);
		expect(model.getState().isDirty).toBe(false);
		expect(model.getState().sequenceError).toContain("checkout-sequence");
		expect(history.getState().past).toEqual([]);
		const view = sequenceDiagrams(before)[0];
		expect(
			model.getState().editSequenceDiagrams(before.diagrams.filter(({ id }) => id !== view.id)),
		).toBe(true);
		canvas.getState().deleteSelected();
		expect(model.getState().model?.elements.map(({ id }) => id)).not.toContain("customer");
	});
});
