import { expect, it } from "vitest";
import { buildInterviewProposal } from "@/lib/interview-proposal";
import { readThreatModelText } from "@/lib/thf-validation";
import fixture from "../../tests/fixtures/thf/v1.1-sequence.thf?raw";
import { createDocumentStores } from "./document-stores";

it("maps explicit reuse and new elements deterministically without writing the graph", () => {
	const { model, interview, history } = createDocumentStores();
	const before = readThreatModelText(fixture);
	model.getState().setModel(before, null);
	interview.getState().start();
	interview.getState().update((state) => ({
		...state,
		answers: {
			...state.answers,
			elements: [
				{ key: 1, role: "external_entity", name: "", reuse: "customer" },
				{ key: 2, role: "process", name: " Checkout ", reuse: "" },
			],
			flows: [
				{ key: 3, name: "Order", from: "existing:customer", to: "answer:2", data: "order, ID" },
			],
			boundaries: [{ key: 4, name: "Orders", members: ["answer:2"] }],
		},
	}));
	const draft = interview.getState().draft;
	if (!draft) throw new Error("Missing interview");
	const proposal = buildInterviewProposal(before, draft.answers);
	expect(proposal).toEqual(buildInterviewProposal(before, draft.answers));
	expect(proposal.changes).toMatchObject([
		{ kind: "element", key: "element-2", value: { name: "Checkout" }, requires: [] },
		{
			kind: "flow",
			value: { from: "customer", to: "interview-element-2-1", data: ["order", "ID"] },
			requires: ["element-2"],
		},
		{ kind: "boundary", value: { contains: ["interview-element-2-1"] }, requires: ["element-2"] },
	]);
	expect(proposal.gaps).toEqual([
		"System scope not answered.",
		"Assets not answered.",
		"Stores not answered.",
	]);
	expect(model.getState().model).toBe(before);
	expect(history.getState().past).toEqual([]);
});

it("proposes boundaries with remaining valid members when a reference is no longer available", () => {
	const model = readThreatModelText(fixture);
	const proposal = buildInterviewProposal(model, {
		scope: "",
		assets: "",
		elements: [],
		flows: [],
		boundaries: [
			{ key: 1, name: "Internal", members: ["answer:9", "existing:checkout"] },
			{ key: 2, name: "Empty", members: ["existing:removed"] },
		],
	});
	expect(proposal.changes).toMatchObject([
		{ kind: "boundary", value: { name: "Internal", contains: ["checkout"] }, requires: [] },
	]);
	expect(proposal.gaps).toContain("A boundary needs a name and valid members.");
	expect(proposal.gaps).toContain("Boundary “Internal” has unavailable members.");
});

it("maps a retained boundary selection to the reused element without a create dependency", () => {
	const model = readThreatModelText(fixture);
	const proposal = buildInterviewProposal(model, {
		scope: "",
		assets: "",
		elements: [{ key: 1, role: "process", name: "Billing", reuse: "checkout" }],
		flows: [],
		boundaries: [{ key: 2, name: "Internal", members: ["answer:1", "existing:customer"] }],
	});
	expect(proposal.changes).toMatchObject([
		{
			kind: "boundary",
			value: { name: "Internal", contains: ["checkout", "customer"] },
			requires: [],
		},
	]);
});
