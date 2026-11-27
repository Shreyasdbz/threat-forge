import { expect, test } from "./fixtures";
import { seedCorruptSoleDocumentWorkspace } from "./support/workspace-fixtures";

test("recovery exposes a corrupt stored record without offering it as a valid document", async ({
	page,
}) => {
	await seedCorruptSoleDocumentWorkspace(page);
	await page.getByRole("button", { name: "Workspace recovery" }).click();
	const recovery = page.getByRole("dialog", { name: "Workspace recovery" });
	await expect(recovery.getByText("Current stored document is unreadable")).toBeVisible();
	await expect(recovery.getByRole("button", { name: "Open" })).toHaveCount(0);
	const download = page.waitForEvent("download");
	await recovery.getByRole("button", { name: "Download recovery bundle" }).click();
	expect((await download).suggestedFilename()).toBe("threatforge-workspace-recovery.json");
});

test("a failed IndexedDB migration is explained without deleting storage", async ({ page }) => {
	await page.addInitScript(() => {
		IDBDatabase.prototype.createObjectStore = () => {
			throw new Error("The migration could not create a store.");
		};
	});
	await page.goto("/app");
	await expect(page.getByTestId("local-persistence-status")).toHaveText("Recovery needed");
	await page.getByRole("button", { name: "Workspace recovery" }).click();
	const recovery = page.getByRole("dialog", { name: "Workspace recovery" });
	await expect(recovery.getByRole("alert")).toContainText("No stored documents were deleted.");
	await expect(
		recovery.getByRole("button", { name: "Download partial recovery bundle" }),
	).toBeVisible();
});
