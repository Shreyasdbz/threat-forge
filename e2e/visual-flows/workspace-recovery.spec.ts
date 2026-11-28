import { expect } from "../fixtures";
import { seedStaleManifestWorkspace } from "../support/workspace-fixtures";
import { checkpoint, test } from "./checkpoint";

test("browser recovery discloses missing documents and confirms clearing", async ({ page }) => {
	await seedStaleManifestWorkspace(page);
	await page.getByRole("button", { name: "Workspace recovery" }).press("Enter");
	const recovery = page.getByRole("dialog", { name: "Workspace recovery" });
	const missing = recovery.getByRole("listitem").filter({ hasText: "Orphaned Tab" });
	await expect(missing).toContainText("Tab metadata only");
	await expect(missing.getByRole("button", { name: "Download .thf" })).toHaveCount(0);
	await checkpoint(page, "workspace-recovery", recovery);

	page.once("dialog", (dialog) => void dialog.dismiss());
	await missing.getByRole("button", { name: "Clear…" }).press("Enter");
	await expect(missing).toBeVisible();
	page.once("dialog", (dialog) => void dialog.accept());
	await missing.getByRole("button", { name: "Clear…" }).press("Enter");
	await expect(missing).toHaveCount(0);
	await expect(recovery.getByRole("button", { name: "Download .thf" })).toBeVisible();

	page.once("dialog", (dialog) => void dialog.accept());
	await recovery.getByRole("button", { name: "Clear browser workspace…" }).press("Enter");
	await expect(recovery.getByText("No browser documents are stored.")).toBeVisible();
	await recovery.getByRole("button", { name: "Close" }).press("Enter");
	await expect(recovery).toHaveCount(0);
	await page.reload();
	await expect(page.getByTestId("empty-canvas")).toBeVisible();
});
