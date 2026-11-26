import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { readThreatModelText } from "@/lib/thf-validation";
import { createDocumentStores, setActiveStores } from "@/stores/document-stores";
import fixture from "../../../tests/fixtures/thf/v1.1-sequence.thf?raw";
import { InterviewControl, InterviewWorkspace } from "./interview-workspace";

afterEach(() => {
	cleanup();
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
