import { expect } from "../fixtures";
import { canvasCheckpoint, checkpoint, test } from "./checkpoint";

test("review the diagram and findings imported from a TM7 model", async ({ page }) => {
	await page.goto("/app");

	await test.step("Import the TM7 reference document", async () => {
		const [chooser] = await Promise.all([
			page.waitForEvent("filechooser"),
			page.getByTestId("btn-import").click(),
		]);
		await chooser.setFiles("src-tauri/src/importers/fixtures/tmt-4.3-sample.tm7");
		await expect(page.getByRole("tab", { name: "Payments & Billing Platform" })).toBeVisible();
		await expect(page.getByText("Browse & Checkout", { exact: true })).toBeVisible();
		await canvasCheckpoint(page, "imported-diagram", 7);
	});

	await test.step("Inspect the imported findings", async () => {
		await page.getByTestId("tab-threats").click();
		const inspector = page.getByTestId("right-panel");
		await expect(
			inspector.getByText('SQL Injection against "Billing Database"', { exact: true }),
		).toBeVisible();
		await checkpoint(page, "imported-findings", inspector);
	});
});
