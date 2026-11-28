import { expect } from "../fixtures";
import { clickElementByName, editElementName, openDocument } from "../support/interactions";
import { canvasCheckpoint, checkpoint, test } from "./checkpoint";

test("open and refine an MCP-authored document in the editor", async ({ page }) => {
	await page.goto("/app");
	const canvas = page.locator(".react-flow");

	await test.step("Open the MCP-authored file", async () => {
		await openDocument(page, "e2e/fixtures/mcp-orders.thf");
		await expect(canvas.getByText("Orders API", { exact: true })).toBeVisible();
		await expect(canvas.getByText("Write order", { exact: true })).toBeVisible();
		await canvasCheckpoint(page, "mcp-authored-diagram", 2);
	});

	await test.step("Rename a component without losing its connection", async () => {
		const service = await clickElementByName(page, "Orders API");
		await editElementName(page, service, "Order Intake API");
		await expect(canvas.getByText("Write order", { exact: true })).toBeVisible();
		await checkpoint(page, "mcp-document-edited", page.getByTestId("right-panel"));
	});
});
