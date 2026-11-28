import type { Locator, Page } from "@playwright/test";
import { test as base, expect, waitForCanvasSettled } from "../fixtures";
import { installDeterministicClock } from "../support/base";

export const test = base.extend<{ visualClock: undefined }>({
	viewport: { width: 1440, height: 900 },
	deviceScaleFactor: 1,
	colorScheme: "light",
	contextOptions: { reducedMotion: "reduce" },
	visualClock: [
		async ({ page }, use, testInfo) => {
			testInfo.skip(
				process.env.CANVAS_VISUAL_BASELINES !== "1",
				"Visual baselines are generated and compared in the pinned Playwright image.",
			);
			await installDeterministicClock(page);
			await use(undefined);
		},
		{ auto: true },
	],
});

export async function checkpoint(page: Page, name: string, surface: Locator): Promise<void> {
	await test.step(`Checkpoint: ${name}`, async () => {
		await expect(surface).toBeVisible();
		await page.evaluate(() => document.fonts.ready);
		await expect(surface).toHaveScreenshot(`${name}.png`, {
			animations: "disabled",
			caret: "hide",
		});
	});
}

export async function canvasCheckpoint(page: Page, name: string, nodeCount: number): Promise<void> {
	const canvas = page.locator(".react-flow");
	await canvas.getByRole("button", { name: "Fit View" }).click();
	await page.mouse.move(0, 0);
	await waitForCanvasSettled(page, nodeCount);
	await checkpoint(page, name, canvas);
}
