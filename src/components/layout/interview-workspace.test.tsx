import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { readThreatModelText } from "@/lib/thf-validation";
import { useDocumentRegistry } from "@/stores/document-registry";
import { createDocumentStores, setActiveStores } from "@/stores/document-stores";
import fixture from "../../../tests/fixtures/thf/v1.1-sequence.thf?raw";
import { InterviewControl, InterviewWorkspace } from "./interview-workspace";

afterEach(() => {
	cleanup();
	useDocumentRegistry.setState({ documents: {}, activeDocumentId: null, openDocumentIds: [] });
	setActiveStores(createDocumentStores());
});

it("keeps skipped answers revisitable in the owning tab and discards on cancel", () => {
	const first = createDocumentStores();
	const second = createDocumentStores();
	const model = readThreatModelText(fixture);
	first.model.getState().setModel(model, null);
	second.model.getState().setModel(model, null);
	setActiveStores(first);
	render(
		<>
			<InterviewControl />
			<InterviewWorkspace>Diagram</InterviewWorkspace>
		</>,
	);
	fireEvent.click(screen.getByRole("button", { name: "Guided interview" }));
	fireEvent.change(screen.getByRole("textbox", { name: "What system are you modeling?" }), {
		target: { value: "Order processing" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Skip" }));
	expect(screen.getByRole("heading", { name: "Actors and services" })).toBeInTheDocument();
	fireEvent.click(screen.getByRole("button", { name: "Back" }));
	expect(screen.getByRole("textbox", { name: "What system are you modeling?" })).toHaveValue(
		"Order processing",
	);
	act(() => setActiveStores(second));
	expect(screen.queryByRole("region", { name: "Guided interview" })).not.toBeInTheDocument();
	act(() => setActiveStores(first));
	expect(screen.getByRole("textbox", { name: "What system are you modeling?" })).toHaveValue(
		"Order processing",
	);
	fireEvent.click(screen.getByRole("button", { name: "Cancel interview" }));
	fireEvent.click(screen.getByRole("button", { name: "Guided interview" }));
	expect(screen.getByRole("textbox", { name: "What system are you modeling?" })).toHaveValue("");
});

it("removes deleted answer references from saved boundary selections", () => {
	const stores = createDocumentStores();
	stores.model.getState().setModel(readThreatModelText(fixture), null);
	setActiveStores(stores);
	stores.interview.getState().start();
	stores.interview.getState().update((draft) => ({
		...draft,
		step: 1,
		nextKey: 3,
		answers: {
			...draft.answers,
			elements: [{ key: 1, role: "process", name: "Billing", reuse: "" }],
			boundaries: {
				definitions: [{ key: 2, name: "Internal" }],
				memberOf: { "answer:1": 2, "existing:checkout": 2 },
			},
		},
	}));
	render(<InterviewWorkspace>Diagram</InterviewWorkspace>);
	fireEvent.click(screen.getByRole("button", { name: "Remove actor or service 1" }));
	expect(stores.interview.getState().draft?.answers.boundaries).toEqual({
		definitions: [{ key: 2, name: "Internal" }],
		memberOf: { "existing:checkout": 2 },
	});
});

it("keeps a selected member visible and removable after switching to reuse", () => {
	const stores = createDocumentStores();
	stores.model.getState().setModel(readThreatModelText(fixture), null);
	setActiveStores(stores);
	stores.interview.getState().start();
	stores.interview.getState().update((draft) => ({
		...draft,
		step: 1,
		nextKey: 3,
		answers: {
			...draft.answers,
			elements: [{ key: 1, role: "process", name: "Billing", reuse: "" }],
			boundaries: {
				definitions: [{ key: 2, name: "Internal" }],
				memberOf: { "answer:1": 2, "existing:customer": 2 },
			},
		},
	}));
	render(<InterviewWorkspace>Diagram</InterviewWorkspace>);
	fireEvent.change(screen.getByRole("combobox", { name: "Create or reuse" }), {
		target: { value: "checkout" },
	});
	for (let step = 0; step < 3; step++) {
		fireEvent.click(screen.getByRole("button", { name: "Continue" }));
	}
	const checkout = screen.getByRole("combobox", { name: "Boundary for Checkout" });
	expect(checkout).toHaveValue("2");
	expect(screen.getByRole("combobox", { name: "Boundary for Customer" })).toHaveValue("2");
	fireEvent.change(checkout, { target: { value: "" } });
	expect(stores.interview.getState().draft?.answers.boundaries.memberOf).toEqual({
		"existing:customer": 2,
	});
});

it("keeps boundary dependencies separate after moving a member in the questionnaire", () => {
	const before = readThreatModelText(fixture);
	const registry = useDocumentRegistry.getState();
	const id = registry.createDocument({ model: before, filePath: null, pendingLayout: null });
	const stores = registry.getDocumentStores(id);
	if (!stores) throw new Error("Missing document");
	stores.interview.getState().start();
	stores.interview.getState().update((draft) => ({
		...draft,
		step: 4,
		nextKey: 5,
		answers: {
			...draft.answers,
			elements: [
				{ key: 1, role: "process", name: "Worker", reuse: "" },
				{ key: 2, role: "process", name: "Gateway", reuse: "" },
			],
			boundaries: {
				definitions: [
					{ key: 3, name: "First tier" },
					{ key: 4, name: "Second tier" },
				],
				memberOf: { "answer:1": 4, "answer:2": 3, "existing:checkout": 4 },
			},
		},
	}));
	render(<InterviewWorkspace>Diagram</InterviewWorkspace>);
	const gateway = screen.getByRole("combobox", { name: "Boundary for Gateway (new)" });
	fireEvent.change(gateway, { target: { value: "4" } });
	expect(gateway).toHaveValue("4");
	fireEvent.change(screen.getByRole("combobox", { name: "Boundary for Worker (new)" }), {
		target: { value: "3" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
	const first = screen.getByRole("checkbox", { name: "First tier (boundary)" });
	const second = screen.getByRole("checkbox", { name: "Second tier (boundary)" });
	fireEvent.click(first);
	expect(second).toBeChecked();
	fireEvent.click(first);
	fireEvent.click(screen.getByRole("checkbox", { name: "Worker (element)" }));
	expect(first).not.toBeChecked();
	expect(second).toBeChecked();
	fireEvent.click(screen.getByRole("button", { name: "Apply selected changes" }));
	expect(stores.model.getState().model?.trust_boundaries).toMatchObject([
		{ name: "Second tier", contains: ["interview-element-2-1", "checkout"] },
	]);
});
