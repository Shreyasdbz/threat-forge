import { expect } from "../fixtures";
import { canvasCheckpoint, test } from "./checkpoint";

test("open a cloud architecture starter without analysis", async ({ page }) => {
	await page.goto("/app");
	await expect(
		page.getByText(/When ready, open Threats and choose Run STRIDE Analysis/),
	).toBeVisible();
	await page.getByTestId("template-cloud-service").click();
	await expect(page.getByTestId("node-entrypoint")).toContainText("Orders Browser");
	await expect(page.getByTestId("node-processor")).toContainText("Orders API");
	await expect(page.getByTestId("node-destination")).toContainText("Orders Database");
	await expect(page.getByTestId("node-note")).toContainText("TLS on both application hops");
	await expect(page.getByTestId("rf__edge-exchange")).toBeVisible();
	await canvasCheckpoint(page, "cloud-service-starter", 5);
});
