import { readFile } from "node:fs/promises";
import { expect, test } from "./fixtures";
import { openDocument, saveDocument } from "./support/interactions";

const starters = [
	["cloud-service", "Orders API", "Database schema"],
	["event-pipeline", "Order Queue", "Queue subscription"],
	["data-platform", "Ingest Job", "Warehouse schema"],
	["desktop-app", "Workspace Service", "Local storage format"],
	["ai-application", "Inference Gateway", "Inference API"],
] as const;

for (const [id, component, relationship] of starters) {
	test(`opens and exports the ${id} architecture starter`, async ({ page }) => {
		await page.goto("/app");
		await page.getByTestId(`template-${id}`).click();
		await expect(page.getByTestId("node-processor")).toContainText(component);
		await page.getByTestId("tab-architecture").click();
		await expect(
			page.getByRole("region", { name: "Groups" }).getByRole("button", { name: component }),
		).toBeVisible();
		await expect(
			page.getByRole("region", { name: "Layers" }).getByRole("button", { name: component }),
		).toBeVisible();
		await page.getByTestId("tab-threats").click();
		await expect(page.getByText(/No threats identified yet/)).toBeVisible();

		await page.getByTestId("btn-present").click();
		const dialog = page.getByRole("dialog");
		const downloading = page.waitForEvent("download");
		await dialog.getByRole("button", { name: "Export SVG" }).click();
		const svg = await readFile(await (await downloading).path(), "utf8");
		expect(svg).toContain(component);
		expect(svg).toContain(relationship);

		if (id === "cloud-service") {
			await page.keyboard.press("Escape");
			const saved = await saveDocument(page);
			await openDocument(page, await saved.path());
			await expect(page.getByTestId("node-processor")).toContainText(component);
			await page.getByTestId("tab-threats").click();
			await expect(page.getByText(/No threats identified yet/)).toBeVisible();
			await page.getByTestId("btn-stride-analyze").click();
			await expect(page.getByRole("button", { name: /Spoofing of Orders API/ })).toBeVisible();
			await expect(page.getByTestId("node-processor")).toContainText(component);
		}
	});
}
