import type { Page } from "@playwright/test";
import {
	addElementResponse,
	openAiPanelWithModel,
	routeAnthropic,
	send,
	textResponse,
} from "./anthropic-sse";
import { expect, test } from "./fixtures";

/**
 * A deterministic, browser-only proof of the bounded tool loop (issue #62).
 *
 * No key and no network: `seedAnthropicApiKey` unlocks the panel and every
 * request to the Anthropic endpoint is fulfilled with a canned SSE body scripted
 * per request. The discriminating case is Stop-while-pending — the node count
 * before and after must be identical, which fails for any implementation that
 * commits a mutation the user never approved.
 */

const nodes = (page: Page) => page.locator("[data-testid^='node-']");

test.describe("AI tool loop", () => {
	test("approving a tool call adds the element to the canvas", async ({ page }, testInfo) => {
		await routeAnthropic(page, [addElementResponse(), textResponse("Done.")]);
		await openAiPanelWithModel(page);
		await expect(nodes(page)).toHaveCount(0);

		await send(page, "add a cache");

		// The mutation is presented for review, not applied automatically.
		const approve = page.getByRole("button", { name: "Apply proposal" });
		await expect(approve).toBeVisible();
		await expect(nodes(page)).toHaveCount(0);
		const pendingScreenshot = testInfo.outputPath("proposal-awaiting-approval.png");
		await page.screenshot({ path: pendingScreenshot, fullPage: true });
		await testInfo.attach("Proposal awaiting approval", {
			path: pendingScreenshot,
			contentType: "image/png",
		});

		await approve.click();
		// Once approved, the element appears on the canvas.
		await expect(nodes(page)).toHaveCount(1);
		await expect(page.getByText("Done.", { exact: true })).toBeVisible();
		const appliedScreenshot = testInfo.outputPath("proposal-applied.png");
		await page.screenshot({ path: appliedScreenshot, fullPage: true });
		await testInfo.attach("Applied proposal and tool result", {
			path: appliedScreenshot,
			contentType: "image/png",
		});
	});

	test("stopping while a call is pending leaves the canvas unchanged", async ({ page }) => {
		await routeAnthropic(page, [addElementResponse(), textResponse("Review this change.")]);
		await openAiPanelWithModel(page);
		await expect(nodes(page)).toHaveCount(0);

		await send(page, "add a cache");
		await expect(page.getByRole("button", { name: "Apply proposal" })).toBeVisible();

		// Stop before approving: the discriminating assertion is that no node was added.
		await page.getByTitle("Stop generating (Esc)").click();
		await expect(page.getByTestId("tool-call-call_1")).toHaveAttribute("data-status", "denied");
		await expect(page.getByText("Not run", { exact: true })).toBeVisible();
		await expect(nodes(page)).toHaveCount(0);
	});

	test("rejecting a proposal keeps the canvas unchanged", async ({ page }) => {
		await routeAnthropic(page, [addElementResponse(), textResponse("Understood.")]);
		await openAiPanelWithModel(page);

		await send(page, "add a cache");
		await page.getByRole("button", { name: "Reject proposal" }).click();

		await expect(page.getByText("Declined", { exact: true })).toBeVisible();
		// The assistant's summary is already available when the proposal is rejected.
		await expect(page.getByText("Understood.")).toBeVisible();
		await expect(nodes(page)).toHaveCount(0);
	});

	test("undoing the turn removes the applied element in one step", async ({ page }) => {
		await routeAnthropic(page, [addElementResponse(), textResponse("Done.")]);
		await openAiPanelWithModel(page);

		await send(page, "add a cache");
		await page.getByRole("button", { name: "Apply proposal" }).click();
		await expect(nodes(page)).toHaveCount(1);

		await page.getByRole("button", { name: /Undo this turn/ }).click();
		await expect(nodes(page)).toHaveCount(0);
	});

	test("reviews and applies a keyboard-selected subset in a narrow panel", async ({ page }) => {
		await page.addInitScript(() =>
			localStorage.setItem("threatforge-panel-widths", JSON.stringify({ left: 224, right: 260 })),
		);
		await routeAnthropic(page, [
			addElementResponse(),
			addElementResponse("Database", "call_2"),
			textResponse("Two proposed components."),
		]);
		await openAiPanelWithModel(page);
		await send(page, "Add a cache and database");
		const review = page.getByRole("region", { name: "Review proposed changes" });
		await review.getByText("2 of 2 operations included").press("Enter");
		const cache = review.getByRole("checkbox", { name: /Cache/ });
		await expect(cache).toBeChecked();
		await cache.press("Space");
		await expect(cache).not.toBeChecked();
		await expect(review.getByText("1 affected item.")).toBeVisible();
		await expect(nodes(page)).toHaveCount(0);
		expect(await review.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
		await review.getByRole("button", { name: "Apply selected" }).press("Enter");
		await expect(nodes(page)).toHaveCount(1);
		await expect(nodes(page).first()).toContainText("Database");
	});
});
