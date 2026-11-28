import { expect } from "../fixtures";
import { openDocument, saveDocument } from "../support/interactions";
import { checkpoint, test } from "./checkpoint";

test("reorder a sequence and present the saved view after reopen", async ({ page }, testInfo) => {
	await page.goto("/app");
	await openDocument(page, "tests/fixtures/thf/v1.1-sequence.thf");
	const views = page.getByRole("combobox", { name: "Diagram view" });
	const editor = page.getByRole("region", { name: "Sequence editor" });

	await test.step("Move the annotation ahead of the linked request", async () => {
		await views.selectOption("checkout-sequence");
		await editor.getByRole("button", { name: "Move message 2 up" }).press("Enter");
		await expect(editor.getByRole("textbox", { name: "Message 1 label" })).toHaveValue(
			"Show receipt",
		);
		await checkpoint(page, "ordered-sequence", editor);
	});

	await test.step("Reopen the saved sequence and present it", async () => {
		const path = testInfo.outputPath("ordered-checkout.thf");
		await (await saveDocument(page)).saveAs(path);
		await openDocument(page, path);
		await expect(views).toHaveValue("");
		await views.selectOption("checkout-sequence");
		await expect(editor.getByRole("textbox", { name: "Message 1 label" })).toHaveValue(
			"Show receipt",
		);
		await page.getByTestId("btn-present").click();
		const presentation = page.getByRole("dialog", { name: "Checkout sequence" });
		const image = presentation.getByRole("img", { name: "Diagram of Checkout sequence" });
		await expect
			.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth))
			.toBeGreaterThan(0);
		await page.mouse.move(0, 0);
		await checkpoint(page, "reopened-sequence-presentation", presentation);
	});
});
