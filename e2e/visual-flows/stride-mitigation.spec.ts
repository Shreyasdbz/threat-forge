import { addPaletteItem, createModel, expect } from "../fixtures";
import { checkpoint, test } from "./checkpoint";

test("analyze a service and record a mitigation", async ({ page }) => {
	await page.goto("/app");
	await createModel(page);
	await addPaletteItem(page, "palette-item-web-server");

	const inspector = page.getByTestId("right-panel");
	const threat = inspector.getByRole("button", { name: /Spoofing of Web Server/ });

	await test.step("Run STRIDE over the current model", async () => {
		await page.getByTestId("tab-threats").click();
		await inspector.getByTestId("btn-stride-analyze").click();
		await expect(threat).toBeVisible();
		await checkpoint(page, "generated-findings", inspector);
	});

	await test.step("Set mitigation status and notes", async () => {
		await threat.click();
		const status = inspector.getByRole("combobox", { name: "Mitigation Status" });
		const notes = inspector.getByRole("textbox", { name: "Mitigation Notes" });
		await status.selectOption("mitigated");
		await notes.fill("Require authenticated service identities.");
		await threat.click();
		await expect(threat).toContainText("Mitigated");
		await threat.click();
		await expect(status).toHaveValue("mitigated");
		await expect(notes).toHaveValue("Require authenticated service identities.");
		await checkpoint(page, "mitigation-editor", inspector);
	});
});
