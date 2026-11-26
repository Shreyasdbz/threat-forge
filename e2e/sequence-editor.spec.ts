import { expect, suppressFirstRunOverlays, test, waitForCanvasSettled } from "./fixtures";
import { clickElementByName, openDocument, saveDocument } from "./support/interactions";

test("keyboard Save commits the focused sequence label", async ({ page }, testInfo) => {
	await page.goto("/app");
	await openDocument(page, "tests/fixtures/thf/v1.1-sequence.thf");
	const views = page.getByRole("combobox", { name: "Diagram view" });
	await views.selectOption("checkout-sequence");
	const label = page.getByRole("textbox", { name: "Message 1 label" });
	await label.fill("Submit payment");
	const [download] = await Promise.all([
		page.waitForEvent("download"),
		label.press("ControlOrMeta+s"),
	]);
	const path = testInfo.outputPath("keyboard-save.thf");
	await download.saveAs(path);
	await openDocument(page, path);
	await expect(views).toHaveValue("");
	await views.selectOption("checkout-sequence");
	await expect(label).toHaveValue("Submit payment");
});

test("opening a sequence's linked flow replaces the graph selection", async ({ page }) => {
	await page.goto("/app");
	await openDocument(page, "tests/fixtures/thf/v1.1-sequence.thf");
	await waitForCanvasSettled(page, 2);
	await clickElementByName(page, "Customer");
	const graph = page.locator(".react-flow");
	await expect(graph.locator(".react-flow__node.selected")).toHaveCount(1);

	await page.getByRole("combobox", { name: "Diagram view" }).selectOption("checkout-sequence");
	await page.getByRole("button", { name: "Show linked flow and findings" }).click();
	await expect(graph.locator(".react-flow__node.selected")).toHaveCount(0);
	await expect(graph.locator('.react-flow__edge[data-id="submit"]')).toHaveClass(/\bselected\b/);
	await page.keyboard.press("Delete");
	await expect(page.getByRole("alert")).toContainText("Unlink or remove the sequence reference");
	await expect(graph.locator(".react-flow__node")).toHaveCount(2);
});

test("creates and edits an ordered sequence with keyboard controls, then reopens it", async ({
	page,
	browser,
	contextOptions,
}, testInfo) => {
	await page.goto("/app");
	await openDocument(page, "tests/fixtures/thf/v1.1-sequence.thf");
	const graph = page.locator(".react-flow");
	await waitForCanvasSettled(page, 2);
	const transform = await graph
		.locator(".react-flow__viewport")
		.evaluate((viewport) => getComputedStyle(viewport).transform);
	await page.getByRole("button", { name: "New sequence" }).press("Enter");
	const editor = page.getByRole("region", { name: "Sequence editor" });
	const name = editor.getByRole("textbox", { name: "Sequence name" });
	await name.fill("Review sequence");
	await name.press("Enter");
	await editor.getByRole("combobox", { name: "Add lifeline" }).selectOption("customer");
	await editor.getByRole("combobox", { name: "Add lifeline" }).selectOption("checkout");
	await editor.getByRole("button", { name: "Add message" }).press("Space");
	await editor.getByRole("button", { name: "Add message" }).press("Space");
	const second = editor.getByRole("textbox", { name: "Message 2 label" });
	await second.fill("First response");
	await second.press("Enter");
	const first = editor.getByRole("textbox", { name: "Message 1 label" });
	await editor.getByRole("button", { name: "Move message 2 up" }).press("Enter");
	await expect(first).toHaveValue("First response");
	await page.keyboard.press("ControlOrMeta+z");
	await expect(first).toHaveValue("New message");
	await page.keyboard.press("ControlOrMeta+Shift+z");
	await expect(first).toHaveValue("First response");
	await page.getByRole("combobox", { name: "Diagram view" }).selectOption("");
	await expect(graph).toBeVisible();
	await expect
		.poll(() =>
			graph
				.locator(".react-flow__viewport")
				.evaluate((viewport) => getComputedStyle(viewport).transform),
		)
		.toBe(transform);
	const path = testInfo.outputPath("sequence.thf");
	await (await saveDocument(page)).saveAs(path);

	const context = await browser.newContext({
		...contextOptions,
		baseURL: new URL(page.url()).origin,
	});
	try {
		const reopened = await context.newPage();
		await suppressFirstRunOverlays(reopened);
		await reopened.goto("/app");
		await openDocument(reopened, path);
		await reopened
			.getByRole("combobox", { name: "Diagram view" })
			.selectOption({ label: "Review sequence" });
		await expect(reopened.getByRole("textbox", { name: "Message 1 label" })).toHaveValue(
			"First response",
		);
	} finally {
		await context.close();
	}
});
