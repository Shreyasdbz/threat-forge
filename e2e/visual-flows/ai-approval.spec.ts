import {
	addElementResponse,
	openAiPanelWithModel,
	routeAnthropic,
	send,
	textResponse,
} from "../anthropic-sse";
import { expect, waitForCanvasSettled } from "../fixtures";
import { checkpoint, test } from "./checkpoint";

test("review, approve, and undo an AI-authored change", async ({ page }) => {
	await routeAnthropic(page, [addElementResponse(), textResponse("Done.")]);
	await openAiPanelWithModel(page);
	const nodes = page.locator(".react-flow__node");
	const inspector = page.getByTestId("right-panel");
	const approve = inspector.getByRole("button", { name: "Approve", exact: true });
	const undo = inspector.getByRole("button", { name: /Undo this turn/ });

	await test.step("Review a proposal before it edits the diagram", async () => {
		await send(page, "add a cache");
		await expect(approve).toBeVisible();
		await expect(nodes).toHaveCount(0);
		await checkpoint(page, "awaiting-approval", inspector);
	});

	await test.step("Approve the proposal and review the edit", async () => {
		await approve.click();
		await waitForCanvasSettled(page, 1);
		await expect(nodes.first()).toContainText("Cache");
		await expect(inspector.getByText("Done.", { exact: true })).toBeVisible();
		await expect(undo).toBeEnabled();
		await checkpoint(page, "applied-change", page.getByTestId("app-layout"));
	});

	await test.step("Undo the accepted turn", async () => {
		await undo.click();
		await expect(nodes).toHaveCount(0);
		await expect(undo).toHaveCount(0);
		await checkpoint(page, "undone-change", inspector);
	});
});
