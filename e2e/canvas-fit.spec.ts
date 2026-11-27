import { expect, test, waitForCanvasSettled } from "./fixtures";
import { openDocument } from "./support/interactions";

test("Fit View contains every element of a 360-node diagram", async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto("/app");
	await openDocument(page, "e2e/fixtures/fit-360-model.thf");
	const pane = page.locator(".react-flow__pane");
	const nodes = page.locator(".react-flow__node-dfdElement");
	await expect(nodes).toHaveCount(360);
	await waitForCanvasSettled(page, 360);

	await page.getByRole("button", { name: "Zoom In" }).click();
	await page.getByRole("button", { name: "Fit View" }).click();

	await expect
		.poll(() =>
			pane.evaluate((element) => {
				const area = element.getBoundingClientRect();
				const nodes =
					element.closest(".react-flow")?.querySelectorAll(".react-flow__node-dfdElement") ?? [];
				const outside = Array.from(nodes).flatMap((node) => {
					const box = node.getBoundingClientRect();
					return box.width > 0 &&
						box.height > 0 &&
						box.left >= area.left &&
						box.top >= area.top &&
						box.right <= area.right &&
						box.bottom <= area.bottom
						? []
						: [node.getAttribute("data-id")];
				});
				return {
					count: nodes.length,
					outsideCount: outside.length,
					firstOutside: outside.slice(0, 5),
				};
			}),
		)
		.toEqual({ count: 360, outsideCount: 0, firstOutside: [] });
});
