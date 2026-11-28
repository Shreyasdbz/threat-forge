import type { Page } from "@playwright/test";
import { createModel } from "./fixtures";
import { expect, failureAwareTest as test } from "./support/base";

async function readOnboardingState(page: Page): Promise<unknown> {
	return page.evaluate<unknown>(() => {
		const raw = localStorage.getItem("threatforge-onboarding");
		return raw === null ? null : JSON.parse(raw);
	});
}

test.describe("Onboarding guide auto-start (real browser, #141)", () => {
	// The shared fixture suppresses both guides for deterministic workflow specs. These tests
	// use plain Playwright contexts and seed only what each first-run contract requires.
	test("welcome guide auto-starts when eligible under StrictMode and can be dismissed", async ({
		page,
	}) => {
		await page.goto("/app");
		await expect(page.getByTestId("whats-new-overlay")).toBeHidden();

		expect(await page.evaluate(() => localStorage.getItem("threatforge-onboarding"))).toBeNull();

		// This fails against the pre-#142 ref guard, whose timer never survived StrictMode replay.
		const tooltip = page.getByTestId("guide-tooltip");
		await expect(tooltip).toBeVisible();
		await expect(tooltip).toHaveAttribute("aria-label", "The canvas");

		await tooltip.getByRole("button", { name: "Skip" }).click();

		await expect(tooltip).toBeHidden();
		expect(await readOnboardingState(page)).toEqual(
			expect.objectContaining({
				dismissedGuideIds: expect.arrayContaining(["welcome"]),
			}),
		);
	});

	test("dfd-basics guide auto-starts after the first model is created and can be dismissed through its UI", async ({
		page,
	}) => {
		await page.goto("/app");
		await expect(page.getByRole("button", { name: "What's New" })).toBeVisible();
		await expect(page.getByTestId("whats-new-overlay")).toBeHidden();
		await createModel(page);

		const tooltip = page.getByTestId("guide-tooltip");
		await expect(tooltip).toBeVisible();
		await expect(tooltip).toHaveAttribute("aria-label", "Add a component");
		await expect(page.getByTestId("guide-overlay")).toBeVisible();

		await tooltip.getByRole("button", { name: "Skip" }).click();

		await expect(tooltip).toBeHidden();
		await expect(page.getByTestId("guide-overlay")).toBeHidden();
		expect(await readOnboardingState(page)).toEqual(
			expect.objectContaining({
				dismissedGuideIds: expect.arrayContaining(["dfd-basics"]),
			}),
		);
	});

	test("an upgrade does not block the launcher and release notes remain available", async ({
		page,
	}) => {
		await page.addInitScript(() => localStorage.setItem("threatforge-last-seen-version", "0.1.0"));
		await page.goto("/app");
		await expect(page.getByTestId("btn-empty-new")).toBeEnabled();
		const notes = page.getByTestId("whats-new-overlay");
		await expect(notes).toBeHidden();
		const trigger = page.getByRole("button", { name: "What's New" });
		await trigger.click();
		await expect(notes).toBeVisible();
		await notes.getByRole("button", { name: "Got it" }).click();
		await expect(notes).toBeHidden();
		await expect(trigger).toBeFocused();
		await trigger.click();
		await expect(notes).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(notes).toBeHidden();
		await createModel(page);
	});
});
