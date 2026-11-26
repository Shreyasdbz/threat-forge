import { afterEach, expect, it } from "vitest";
import { readThreatModelText } from "@/lib/thf-validation";
import { useDocumentRegistry } from "@/stores/document-registry";
import { createDocumentStores, setActiveStores } from "@/stores/document-stores";
import fixture from "../../tests/fixtures/thf/v1.1-sequence.thf?raw";
import { applyInterviewReview, reviewInterview, selectInterviewChange } from "./interview-review";

afterEach(() => {
	useDocumentRegistry.setState({ documents: {}, activeDocumentId: null, openDocumentIds: [] });
	setActiveStores(createDocumentStores());
});

it("refuses cross-tab and stale previews and applies only selected additions in one undo entry", () => {
	const before = readThreatModelText(fixture);
	const registry = useDocumentRegistry.getState();
	const id = registry.createDocument({
		model: before,
		filePath: null,
		fileRevision: "one",
		pendingLayout: null,
	});
	const stores = registry.getDocumentStores(id);
	if (!stores) throw new Error("Missing document");
	const answers = {
		scope: "Private notes",
		assets: "",
		elements: [{ key: 1, role: "process" as const, name: "Billing", reuse: "" }],
		flows: [{ key: 2, name: "Order", from: "existing:customer", to: "answer:1", data: "" }],
		boundaries: [{ key: 3, name: "Internal", members: ["answer:1"] }],
	};
	const review = reviewInterview(stores, answers);
	if (!review) throw new Error("Missing review");

	const otherId = registry.createDocument({ model: before, filePath: null, pendingLayout: null });
	expect(applyInterviewReview(stores, review)).toContain("document changed");
	expect(registry.getDocumentStores(otherId)?.model.getState().model).toBe(before);
	registry.activateDocument(id);
	stores.model.setState({ fileRevision: "two" });
	expect(applyInterviewReview(stores, review)).toContain("document changed");
	stores.model.setState({ fileRevision: "one", model: { ...before } });
	expect(applyInterviewReview(stores, review)).toContain("document changed");
	expect(stores.history.getState().past).toEqual([]);

	const refreshed = reviewInterview(stores, answers);
	if (!refreshed) throw new Error("Missing rebuilt review");
	const none = selectInterviewChange(refreshed, "element-1", false);
	expect(none.selected.size).toBe(0);
	const partial = selectInterviewChange(none, "flow-2", true);
	expect([...partial.selected]).toEqual(["flow-2", "element-1"]);
	expect(applyInterviewReview(stores, partial)).toBeNull();
	const committed = stores.model.getState().model;
	if (!committed) throw new Error("Missing committed model");
	expect(committed.elements.map(({ name }) => name)).toContain("Billing");
	expect(committed.data_flows.map(({ name }) => name)).toContain("Order");
	expect(committed.trust_boundaries).toEqual(before.trust_boundaries);
	expect(stores.history.getState().past).toHaveLength(1);
	expect(stores.history.getState().undo(committed)).toEqual(before);
});
