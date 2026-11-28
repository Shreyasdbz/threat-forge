import { render, screen } from "@testing-library/react";
import type { NodeProps } from "@xyflow/react";
import { describe, expect, it, vi } from "vitest";
import type { DfdNodeData } from "@/stores/canvas-store";
import { DfdElementNode } from "./dfd-element-node";

const renderHandle = vi.hoisted(() => vi.fn());

// `Handle` only needs to render something inert here — this file asserts on the wrapper's
// ancestry, not on handle visibility (covered by shared-handles.test.tsx).
vi.mock("@xyflow/react", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@xyflow/react")>();
	return {
		...actual,
		Handle: ({ id }: { id: string }) => {
			renderHandle();
			return <div data-testid={`handle-${id}`} />;
		},
	};
});

function makeProps(elementType: string): NodeProps {
	const data: DfdNodeData = {
		label: "Test Element",
		elementType,
		trustZone: "",
		description: "",
		technologies: [],
	};
	return {
		id: "n1",
		data,
		type: "dfdElement",
		dragging: false,
		zIndex: 0,
		selectable: true,
		deletable: true,
		selected: false,
		draggable: true,
		isConnectable: true,
		positionAbsoluteX: 0,
		positionAbsoluteY: 0,
	};
}

describe("DfdElementNode group ancestor", () => {
	it("wraps the rounded/rect shape branch's handles in a .group ancestor", () => {
		// "generic" resolves to the default "rounded" shape — the non-hexagon branch.
		render(<DfdElementNode {...makeProps("generic")} />);

		const handle = screen.getByTestId("handle-top-target");
		expect(handle.closest(".group")).not.toBeNull();
	});

	it("wraps the hexagon shape branch's handles in a .group ancestor", () => {
		// "load_balancer" is defined with shape: "hexagon" in the component library.
		render(<DfdElementNode {...makeProps("load_balancer")} />);

		const handle = screen.getByTestId("handle-top-target");
		expect(handle.closest(".group")).not.toBeNull();
	});
});

it("does not rebuild an element's handles when React Flow measures or moves the wrapper", () => {
	const props = makeProps("generic");
	const { rerender } = render(<DfdElementNode {...props} />);
	const handleRenders = renderHandle.mock.calls.length;
	const measured = { ...props, width: 208, height: 72, positionAbsoluteX: 50 };
	rerender(<DfdElementNode {...measured} />);
	expect(renderHandle).toHaveBeenCalledTimes(handleRenders);

	rerender(<DfdElementNode {...measured} data={{ ...props.data, label: "Updated" }} />);
	expect(screen.getByText("Updated")).toBeVisible();
});
