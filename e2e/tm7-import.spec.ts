import { expect, test } from "./fixtures";

test("imports the native TM7 reference fixture into a new browser tab", async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 775 });
	await page.goto("/app");
	const [chooser] = await Promise.all([
		page.waitForEvent("filechooser"),
		page.getByTestId("btn-import").click(),
	]);
	await chooser.setFiles("src-tauri/src/importers/fixtures/tmt-4.3-sample.tm7");
	await expect(
		page
			.getByRole("tablist", { name: "Open documents" })
			.getByRole("tab", { name: "Payments & Billing Platform" }),
	).toBeVisible();
	await expect(page.getByTestId("node-payments-billing-api")).toBeVisible();
	await expect(page.getByText("Browse & Checkout", { exact: true })).toBeVisible();
	const canvas = page.locator(".react-flow");
	const database = canvas.getByTestId("node-billing-database");
	await expect
		.poll(async () => {
			const [area, node] = await Promise.all([canvas.boundingBox(), database.boundingBox()]);
			return area != null && node != null && node.x + node.width <= area.x + area.width;
		})
		.toBe(true);
	await page.getByTestId("tab-threats").click();
	await expect(
		page.getByText('SQL Injection against "Billing Database"', { exact: true }),
	).toBeVisible();
});

test("rejects a non-TM7 XML file without opening a document", async ({ page }) => {
	await page.goto("/app");
	const tabs = page.getByRole("tablist", { name: "Open documents" }).getByRole("tab");
	const count = await tabs.count();
	const [chooser] = await Promise.all([
		page.waitForEvent("filechooser"),
		page.getByTestId("btn-import").click(),
	]);
	const message = page.waitForEvent("dialog").then(async (dialog) => {
		const text = dialog.message();
		await dialog.dismiss();
		return text;
	});
	await chooser.setFiles({
		name: "other.tm7",
		mimeType: "application/xml",
		buffer: Buffer.from("<OtherDocument/>"),
	});
	await expect(message).resolves.toContain("Could not import");
	await expect(tabs).toHaveCount(count);
});
