import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
			elements: [
				{ key: 1, role: "process", name: "Billing", reuse: "", boundary: 2 },
				{ key: 3, role: "process", name: "", reuse: "checkout", boundary: 2 },
			],
			boundaries: [{ key: 2, name: "Internal" }],
		},
	}));
	render(<InterviewWorkspace>Diagram</InterviewWorkspace>);
	fireEvent.click(screen.getByRole("button", { name: "Remove actor or service 1" }));
	expect(stores.interview.getState().draft?.answers.elements).toEqual([
		{ key: 3, role: "process", name: "", reuse: "checkout", boundary: 2 },
	]);
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
			elements: [
				{ key: 1, role: "process", name: "Billing", reuse: "", boundary: 2 },
				{ key: 3, role: "external_entity", name: "", reuse: "customer", boundary: 2 },
			],
			boundaries: [{ key: 2, name: "Internal" }],
		},
	}));
	render(<InterviewWorkspace>Diagram</InterviewWorkspace>);
	fireEvent.change(
		within(screen.getByRole("group", { name: "Actor or service 1" })).getByRole("combobox", {
			name: "Create or reuse",
		}),
		{
			target: { value: "checkout" },
		},
	);
	for (let step = 0; step < 3; step++) {
		fireEvent.click(screen.getByRole("button", { name: "Continue" }));
	}
	const checkout = screen.getByRole("combobox", { name: "Boundary for Checkout" });
	expect(checkout).toHaveValue("2");
	expect(screen.getByRole("combobox", { name: "Boundary for Customer" })).toHaveValue("2");
	fireEvent.change(checkout, { target: { value: "" } });
	expect(
		stores.interview.getState().draft?.answers.elements.map(({ boundary }) => boundary),
	).toEqual([undefined, 2]);
});

it("keeps a single membership across the interview boundary lifecycle", () => {
	const before = readThreatModelText(fixture);
	const registry = useDocumentRegistry.getState();
	const id = registry.createDocument({ model: before, filePath: null, pendingLayout: null });
	const stores = registry.getDocumentStores(id);
	if (!stores) throw new Error("Missing document");
	stores.interview.getState().start();
	stores.interview.getState().update((draft) => ({
		...draft,
		step: 1,
		nextKey: 4,
		answers: {
			...draft.answers,
			boundaries: [
				{ key: 2, name: "Internal" },
				{ key: 3, name: "Other" },
			],
		},
	}));
	render(<InterviewWorkspace>Diagram</InterviewWorkspace>);
	const navigate = (name: "Continue" | "Back") => {
		for (let step = 0; step < 3; step++) fireEvent.click(screen.getByRole("button", { name }));
	};
	const membership = (name: string) =>
		screen.getByRole("combobox", { name: `Boundary for ${name}` });
	const choose = (name: string, value: string) =>
		fireEvent.change(membership(name), { target: { value } });
	const reuse = (value: string) => {
		navigate("Back");
		fireEvent.change(screen.getByRole("combobox", { name: "Create or reuse" }), {
			target: { value },
		});
		navigate("Continue");
	};
	const cases = [
		[
			"direct membership survives unassigned reuse, reuse-change, and answer removal",
			() => {
				navigate("Continue");
				choose("Customer", "3");
				navigate("Back");
				fireEvent.click(screen.getByRole("button", { name: "Add actor or service" }));
				const target = screen.getByRole("combobox", { name: "Create or reuse" });
				fireEvent.change(target, { target: { value: "customer" } });
				navigate("Continue");
				expect(membership("Customer")).toHaveValue("3");
				reuse("checkout");
				expect(membership("Customer")).toHaveValue("3");
				expect(membership("Checkout")).toHaveValue("");
				reuse("customer");
				navigate("Back");
				fireEvent.click(screen.getByRole("button", { name: "Remove actor or service 1" }));
				expect(stores.interview.getState().draft?.answers.elements).toEqual([
					{ existing: "customer", boundary: 3 },
				]);
				navigate("Continue");
				choose("Customer", "");
				navigate("Back");
			},
		],
		[
			"create",
			() => {
				fireEvent.click(screen.getByRole("button", { name: "Add actor or service" }));
				fireEvent.change(screen.getByRole("textbox", { name: "Actor or service 1 name" }), {
					target: { value: "Billing" },
				});
				navigate("Continue");
				choose("Billing (new)", "2");
				expect(membership("Billing (new)")).toHaveValue("2");
			},
		],
		[
			"assign and clear an existing target without creating an answer",
			() => {
				choose("Checkout", "3");
				expect(stores.interview.getState().draft?.answers.elements).toContainEqual({
					existing: "checkout",
					boundary: 3,
				});
				choose("Checkout", "");
				expect(stores.interview.getState().draft?.answers.elements).toHaveLength(1);
			},
		],
		[
			"reuse",
			() => {
				choose("Checkout", "3");
				reuse("checkout");
				expect(membership("Checkout")).toHaveValue("2");
				expect(stores.interview.getState().draft?.answers.elements).toContainEqual({
					existing: "checkout",
					boundary: 3,
				});
				fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
				expect(screen.getByRole("checkbox", { name: "Internal (boundary)" })).toBeChecked();
				expect(
					screen.queryByRole("checkbox", { name: "Other (boundary)" }),
				).not.toBeInTheDocument();
				fireEvent.click(screen.getByRole("button", { name: "Back" }));
			},
		],
		[
			"reuse-change",
			() => {
				reuse("customer");
				expect(membership("Customer")).toHaveValue("2");
				expect(membership("Checkout")).toHaveValue("3");
			},
		],
		[
			"move",
			() => {
				choose("Customer", "3");
				expect(membership("Customer")).toHaveValue("3");
			},
		],
		[
			"delete boundary",
			() => {
				choose("Checkout", "3");
				fireEvent.click(screen.getByRole("button", { name: "Remove boundary 2" }));
				expect(membership("Customer")).toHaveValue("");
				expect(membership("Checkout")).toHaveValue("");
				expect(stores.interview.getState().draft?.answers.elements).toHaveLength(1);
				choose("Customer", "2");
				fireEvent.click(screen.getByRole("button", { name: "Add boundary" }));
				fireEvent.change(screen.getAllByRole("textbox", { name: "Boundary name" })[1], {
					target: { value: "Review only" },
				});
				const option = within(membership("Checkout")).getByRole<HTMLOptionElement>("option", {
					name: "Review only",
				});
				choose("Checkout", option.value);
			},
		],
		[
			"uncheck in review",
			() => {
				fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
				fireEvent.click(screen.getByRole("checkbox", { name: "Review only (boundary)" }));
				expect(screen.getByRole("checkbox", { name: "Internal (boundary)" })).toBeChecked();
			},
		],
		[
			"apply",
			() => {
				fireEvent.click(screen.getByRole("button", { name: "Apply selected changes" }));
				expect(stores.model.getState().model?.trust_boundaries).toMatchObject([
					{ name: "Internal", contains: ["customer"] },
				]);
			},
		],
	] as const;
	for (const [, exercise] of cases) exercise();
});

it("keeps skipped actor and store questions unanswered when linking existing model elements", () => {
	const fixtureModel = readThreatModelText(fixture);
	const before = {
		...fixtureModel,
		elements: fixtureModel.elements.map((element) =>
			element.id === "customer" ? { ...element, type: "data_store" } : element,
		),
	};
	const registry = useDocumentRegistry.getState();
	registry.createDocument({ model: before, filePath: null, pendingLayout: null });
	render(
		<>
			<InterviewControl />
			<InterviewWorkspace>Diagram</InterviewWorkspace>
		</>,
	);
	fireEvent.click(screen.getByRole("button", { name: "Guided interview" }));
	for (let step = 0; step < 4; step++)
		fireEvent.click(screen.getByRole("button", { name: "Skip" }));
	fireEvent.click(screen.getByRole("button", { name: "Add boundary" }));
	fireEvent.change(screen.getByRole("textbox", { name: "Boundary name" }), {
		target: { value: "Internal" },
	});
	for (const name of ["Customer", "Checkout"]) {
		fireEvent.change(screen.getByRole("combobox", { name: `Boundary for ${name}` }), {
			target: { value: "1" },
		});
	}
	fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
	expect(screen.getByText("Actors and services not answered.")).toBeVisible();
	expect(screen.getByText("Stores not answered.")).toBeVisible();
	expect(screen.getByRole("checkbox", { name: "Internal (boundary)" })).toBeChecked();
	fireEvent.click(screen.getByRole("button", { name: "Optional AI follow-up" }));
	expect(screen.getByRole("checkbox", { name: "Actors, services and stores" })).toBeDisabled();
	expect(screen.getByRole("checkbox", { name: "Trust boundaries" })).toBeEnabled();
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
				{ key: 1, role: "process", name: "Worker", reuse: "", boundary: 4 },
				{ key: 2, role: "process", name: "Gateway", reuse: "", boundary: 3 },
				{ key: 5, role: "process", name: "", reuse: "checkout", boundary: 4 },
			],
			boundaries: [
				{ key: 3, name: "First tier" },
				{ key: 4, name: "Second tier" },
			],
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
