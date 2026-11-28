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
		elements: [{ key: 1, role: "process" as const, name: "Billing", reuse: "", boundary: 3 }],
		flows: [{ key: 2, name: "Order", from: "existing:customer", to: "answer:1", data: "" }],
		boundaries: [{ key: 3, name: "Internal" }],
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

it("wraps positioned members without moving them in the diagram or exported model", () => {
	const fixtureModel = readThreatModelText(fixture);
	const before = {
		...fixtureModel,
		elements: fixtureModel.elements.map((element, index) => ({
			...element,
			position: { x: 840 + 400 * index, y: 700 + 200 * index },
			size: { width: 240, height: 90 },
		})),
	};
	const registry = useDocumentRegistry.getState();
	const id = registry.createDocument({ model: before, filePath: null, pendingLayout: null });
	const stores = registry.getDocumentStores(id);
	if (!stores) throw new Error("Missing document");
	stores.canvas.getState().syncFromModel();
	const review = reviewInterview(stores, {
		scope: "",
		assets: "",
		elements: [
			{ key: 2, role: "external_entity", name: "", reuse: "customer", boundary: 1 },
			{ key: 3, role: "process", name: "", reuse: "checkout", boundary: 1 },
		],
		flows: [],
		boundaries: [{ key: 1, name: "Internal" }],
	});
	if (!review) throw new Error("Missing review");
	expect(applyInterviewReview(stores, review)).toBeNull();

	const model = stores.model.getState().model;
	const boundary = model?.trust_boundaries[0];
	if (!model || !boundary?.position || !boundary.size) throw new Error("Missing boundary layout");
	const nodes = stores.canvas.getState().nodes;
	expect(nodes.find(({ id }) => id === boundary.id)?.position).toEqual(boundary.position);
	for (const original of before.elements) {
		const local = model.elements.find(({ id }) => id === original.id)?.position;
		if (!local) throw new Error("Missing member layout");
		expect(local.x).toBeGreaterThan(0);
		expect(local.y).toBeGreaterThan(0);
		expect(local.x + original.size.width).toBeLessThan(boundary.size.width);
		expect(local.y + original.size.height).toBeLessThan(boundary.size.height);
		expect({ x: boundary.position.x + local.x, y: boundary.position.y + local.y }).toEqual(
			original.position,
		);
		expect(nodes.find(({ id }) => id === original.id)).toMatchObject({
			parentId: boundary.id,
			position: local,
		});
	}
	expect(stores.history.getState().undo(model)).toEqual(before);
});

it("keeps members in their first boundary and discloses exclusions before applying", () => {
	const before = {
		...readThreatModelText(fixture),
		trust_boundaries: [{ id: "public", name: "Public", contains: ["customer"] }],
	};
	const registry = useDocumentRegistry.getState();
	const id = registry.createDocument({ model: before, filePath: null, pendingLayout: null });
	const stores = registry.getDocumentStores(id);
	if (!stores) throw new Error("Missing document");
	const review = reviewInterview(stores, {
		scope: "",
		assets: "",
		elements: [
			{ key: 1, role: "external_entity", name: "", reuse: "customer", boundary: 3 },
			{ key: 2, role: "process", name: "Billing", reuse: "", boundary: 4 },
			{ key: 5, role: "process", name: "", reuse: "checkout", boundary: 3 },
		],
		flows: [],
		boundaries: [
			{ key: 3, name: "Checkout tier" },
			{ key: 4, name: "Billing tier" },
		],
	});
	if (!review) throw new Error("Missing review");
	expect(review.gaps).toContain(
		"Boundary “Checkout tier” excludes “Customer”, already in “Public”.",
	);
	expect(applyInterviewReview(stores, review)).toBeNull();
	expect(
		stores.model.getState().model?.trust_boundaries.map(({ name, contains }) => [name, contains]),
	).toEqual([
		["Public", ["customer"]],
		["Checkout tier", ["checkout"]],
		["Billing tier", ["interview-element-2-1"]],
	]);
});

it("retains the chosen membership when an unrelated boundary is unchecked", () => {
	const before = readThreatModelText(fixture);
	const registry = useDocumentRegistry.getState();
	const id = registry.createDocument({ model: before, filePath: null, pendingLayout: null });
	const stores = registry.getDocumentStores(id);
	if (!stores) throw new Error("Missing document");
	const review = reviewInterview(stores, {
		scope: "",
		assets: "",
		elements: [
			{ key: 3, role: "external_entity", name: "", reuse: "customer", boundary: 1 },
			{ key: 4, role: "process", name: "", reuse: "checkout", boundary: 2 },
		],
		flows: [],
		boundaries: [
			{ key: 1, name: "First tier" },
			{ key: 2, name: "Second tier" },
		],
	});
	if (!review) throw new Error("Missing review");
	const secondOnly = selectInterviewChange(review, "boundary-1", false);
	expect(secondOnly.selected).toEqual(new Set(["boundary-2"]));
	expect(applyInterviewReview(stores, secondOnly)).toBeNull();
	expect(
		stores.model.getState().model?.trust_boundaries.map(({ name, contains }) => [name, contains]),
	).toEqual([["Second tier", ["checkout"]]]);
});
