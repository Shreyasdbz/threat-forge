import { expect, test } from "./fixtures";
import { assertNoSeriousAccessibilityViolations } from "./support/accessibility";
import { openDocument } from "./support/interactions";

const fixture = "tests/fixtures/thf/architecture-canonical-full.thf";

for (const colorScheme of ["light", "dark"] as const) {
	test.describe(`${colorScheme} editor`, () => {
		test.use({ colorScheme });

		test("main editor states pass automated WCAG checks", async ({ page }) => {
			await page.goto("/app");
			await expect(page.getByTestId("empty-canvas")).toBeVisible();
			await test.step("empty workspace", async () => {
				await assertNoSeriousAccessibilityViolations(page);
			});
			await openDocument(page, fixture);
			await page.getByTestId("node-web-app").click();
			await expect(page.getByRole("heading", { name: "Web Application" })).toBeVisible();

			for (const tab of ["Properties", "Architecture", "Threats", "AI"]) {
				await test.step(tab, async () => {
					await page.getByRole("tab", { name: tab, exact: true }).click();
					await expect(page.getByRole("tabpanel", { name: tab, exact: true })).toBeVisible();
					await assertNoSeriousAccessibilityViolations(page);
				});
			}

			await test.step("settings", async () => {
				await page.getByTestId("btn-settings-dialog").click();
				await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
				await assertNoSeriousAccessibilityViolations(page);
			});
		});
	});
}

test("operates the inspector, dialogs and a canvas selection by keyboard", async ({ page }) => {
	await page.goto("/app");
	await openDocument(page, fixture);
	const tabs = page.getByRole("tablist", { name: "Inspector" });
	const properties = tabs.getByRole("tab", { name: "Properties" });
	const architecture = tabs.getByRole("tab", { name: "Architecture" });
	await properties.focus();
	await page.keyboard.press("ArrowRight");
	await expect(architecture).toBeFocused();
	await expect(properties).toHaveAttribute("aria-selected", "true");
	await page.keyboard.press("Enter");
	await expect(architecture).toHaveAttribute("aria-selected", "true");
	await page.keyboard.press("Tab");
	await expect(page.getByRole("tabpanel", { name: "Architecture", exact: true })).toBeFocused();

	const settings = page.getByTestId("btn-settings-dialog");
	await settings.press("Enter");
	const dialog = page.getByRole("dialog", { name: "Settings" });
	await expect(dialog).toBeVisible();
	await expect(dialog.getByRole("button", { name: "General" })).toBeFocused();
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
	await expect(settings).toBeFocused();

	await page.keyboard.press("Control+k");
	const commands = page.getByRole("dialog", { name: "Command palette" });
	await expect(commands.getByRole("textbox", { name: "Search commands" })).toBeFocused();
	await page.keyboard.press("ArrowDown");
	await page.keyboard.press("Escape");
	await expect(commands).toBeHidden();
	await expect(settings).toBeFocused();

	await page.getByRole("button", { name: "Select boundary" }).first().press("Enter");
	await expect(properties).toHaveAttribute("aria-selected", "true");
	await expect(page.getByRole("textbox", { name: "Name", exact: true })).toHaveValue(
		"Corporate Network",
	);
});

test("reflows editor chrome at a 200% zoom-equivalent viewport", async ({ page }) => {
	await page.setViewportSize({ width: 720, height: 450 });
	await page.goto("/app");
	await openDocument(page, fixture);
	const tabs = page.getByRole("tablist", { name: "Inspector" });
	await tabs.getByRole("tab", { name: "Architecture" }).scrollIntoViewIfNeeded();
	await expect(tabs).toBeInViewport();
	await expect(page.getByRole("main")).toHaveCSS("min-height", "320px");
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(720);
});

test("scrolls the focused inspector without moving the selected canvas node", async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 500 });
	await page.goto("/app");
	await openDocument(page, fixture);
	const node = page.getByTestId("node-web-app");
	await node.click();
	const nodeWrapper = page.locator(".react-flow__node.selected");
	await expect(nodeWrapper).toHaveCount(1);
	const position = await nodeWrapper.evaluate((element) => getComputedStyle(element).transform);
	const panel = page.getByTestId("right-panel").getByRole("tabpanel", { name: "Properties" });
	await panel.focus();
	await page.keyboard.press("ArrowDown");
	await expect.poll(() => panel.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
	await expect(nodeWrapper).toHaveCSS("transform", position);
});

test("keeps library results reachable below the fixed controls in the stacked editor", async ({
	page,
}) => {
	await page.setViewportSize({ width: 720, height: 450 });
	await page.goto("/app");
	await openDocument(page, fixture);
	const results = page.getByRole("region", { name: "Library components" });
	await results.hover();
	const { height, bottom, canvasTop } = await results.evaluate((element) => {
		const bounds = element.getBoundingClientRect();
		const canvas = document.querySelector("main");
		if (!canvas) throw new Error("Canvas is missing");
		return {
			height: bounds.height,
			bottom: bounds.bottom,
			canvasTop: canvas.getBoundingClientRect().top,
		};
	});
	expect(height).toBeGreaterThanOrEqual(40);
	expect(bottom).toBeLessThanOrEqual(canvasTop);
	await page.mouse.wheel(0, 300);
	await expect.poll(() => results.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
});
