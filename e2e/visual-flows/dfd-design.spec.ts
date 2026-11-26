import {
	addPaletteItem,
	createModel,
	expect,
	suppressFirstRunOverlays,
	waitForCanvasSettled,
} from "../fixtures";
import { installDeterministicClock } from "../support/base";
import {
	clickElementByName,
	connectElements,
	dragElementBy,
	editElementName,
	openDocument,
	saveDocument,
} from "../support/interactions";
import { canvasCheckpoint, checkpoint, test } from "./checkpoint";

test("design, name, and reopen a data flow diagram", async ({
	page,
	browser,
	contextOptions,
}, testInfo) => {
	await page.goto("/app");
	const inspector = page.getByTestId("right-panel");
	const name = "Checkout Service";

	await test.step("Connect a service to its database", async () => {
		await createModel(page);
		await addPaletteItem(page, "palette-item-web-server");
		await addPaletteItem(page, "palette-item-sql-database");
		await waitForCanvasSettled(page, 2);
		const service = await clickElementByName(page, "Web Server");
		const database = await clickElementByName(page, "SQL Database");
		await dragElementBy(page, database, 180, 65);
		await connectElements(page, service, database);
		await canvasCheckpoint(page, "connected-canvas", 2);
	});

	await test.step("Rename the service in Properties", async () => {
		const service = await clickElementByName(page, "Web Server");
		await editElementName(page, service, name);
		await expect(inspector.getByRole("textbox", { name: "Name", exact: true })).toHaveValue(name);
		await checkpoint(page, "edited-properties", inspector);
	});

	await test.step("Open the exported model in a fresh browser page", async () => {
		const path = testInfo.outputPath("checkout.thf");
		await (await saveDocument(page)).saveAs(path);
		// A fresh context cannot recover the diagram from the original workspace's IndexedDB.
		const context = await browser.newContext({
			...contextOptions,
			baseURL: new URL(page.url()).origin,
		});
		try {
			const reopened = await context.newPage();
			await installDeterministicClock(reopened);
			await suppressFirstRunOverlays(reopened);
			await reopened.goto("/app");
			await openDocument(reopened, path);
			await waitForCanvasSettled(reopened, 2);
			await expect(reopened.locator(".react-flow__edge")).toHaveCount(1);
			await expect(reopened.locator(".react-flow__node").filter({ hasText: name })).toBeVisible();
			await canvasCheckpoint(reopened, "reopened-canvas", 2);
		} finally {
			await context.close();
		}
	});
});
