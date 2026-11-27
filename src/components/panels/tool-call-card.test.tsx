import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { CallRecord, CallStatus } from "@/lib/ai/loop/turn-machine";
import { ToolCallCard } from "./tool-call-card";

function mk(overrides: Partial<CallRecord> & Pick<CallRecord, "id" | "status">): CallRecord {
	return {
		toolName: "add_element",
		inputDigest: "d",
		summary: "Add element: Cache (data_store)",
		effect: "mutate",
		destructive: false,
		iteration: 1,
		prepared: null,
		result: null,
		isError: false,
		denialReason: null,
		...overrides,
	};
}

describe("ToolCallCard untrusted text rendering", () => {
	it("renders a hostile summary as literal text with no markup", () => {
		const summary = '<img src=x onerror="alert(1)"> [click](javascript:alert(1)) **bold**';
		const { container } = render(
			<ToolCallCard call={mk({ id: "c1", status: "pending", summary })} />,
		);
		// No element was created from the model's text.
		expect(container.querySelector("img")).toBeNull();
		expect(container.querySelector("a")).toBeNull();
		expect(container.querySelector("strong")).toBeNull();
		// The markup is visible as literal characters.
		expect(container.textContent).toContain("<img");
		expect(container.textContent).toContain("**bold**");
	});
});

describe("ToolCallCard statuses", () => {
	it.each(["succeeded", "undone"] as const)(
		"keeps creation feedback readable when %s",
		(status) => {
			const result = '{"action":"add_element","id":"comp-1"}';
			render(<ToolCallCard call={mk({ id: "c1", status, result })} />);
			expect(screen.getByText("Add element: Cache (data_store)")).toBeVisible();
			expect(screen.getByText(status === "succeeded" ? "Applied" : "Undone")).toBeVisible();
			expect(screen.queryByText(result)).toBeNull();
		},
	);

	it("still shows a creation failure's corrective feedback", () => {
		render(
			<ToolCallCard
				call={mk({ id: "c1", status: "failed", isError: true, result: "The document changed." })}
			/>,
		);
		expect(screen.getByText("The document changed.")).toBeVisible();
	});

	it("is informational and has no per-call approval buttons", () => {
		render(<ToolCallCard call={mk({ id: "c1", status: "pending" })} />);
		expect(screen.getByText("Awaiting review")).toBeInTheDocument();
		expect(screen.queryByRole("button")).not.toBeInTheDocument();
	});

	it("renders a distinct chip for each terminal and in-flight status", () => {
		const cases: Array<[CallStatus, string]> = [
			["approved", "Queued"],
			["running", "Preparing…"],
			["succeeded", "Applied"],
			["failed", "Failed"],
			["undone", "Undone"],
		];
		for (const [status, label] of cases) {
			const { unmount } = render(<ToolCallCard call={mk({ id: "c1", status })} />);
			expect(screen.getByText(label)).toBeInTheDocument();
			unmount();
		}
	});

	it("labels a user-declined call Declined and a not-run call Not run", () => {
		const { unmount } = render(
			<ToolCallCard call={mk({ id: "c1", status: "denied", denialReason: "user_declined" })} />,
		);
		expect(screen.getByText("Declined")).toBeInTheDocument();
		unmount();

		render(
			<ToolCallCard call={mk({ id: "c2", status: "denied", denialReason: "turn_cancelled" })} />,
		);
		expect(screen.getByText("Not run")).toBeInTheDocument();
	});
});
