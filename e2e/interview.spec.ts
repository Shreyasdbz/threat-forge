import { readFile } from "node:fs/promises";
import { textResponse } from "./anthropic-sse";
import { expect, seedAnthropicApiKey, test } from "./fixtures";
import { openDocument, saveDocument } from "./support/interactions";
import { buildOfflineInterview } from "./support/interview";

test("answer field undo and redo do not change document history", async ({ page }) => {
	await page.goto("/app");
	await openDocument(page, "tests/fixtures/thf/v1.1-sequence.thf");
	await page.getByRole("button", { name: "New sequence" }).click();
	const sequence = page.getByRole("region", { name: "Sequence editor" });
	await expect(sequence).toBeVisible();
	await page.getByRole("button", { name: "Guided interview" }).click();
	await expect(page.getByTestId("right-panel")).toBeHidden();
	const answer = page.getByRole("textbox", { name: "What system are you modeling?" });
	await answer.pressSequentially("Checkout");
	await answer.press("ControlOrMeta+z");
	await expect(answer).toHaveValue("");
	await answer.press("ControlOrMeta+Shift+z");
	await expect(answer).toHaveValue("Checkout");
	await page.getByRole("button", { name: "Return to diagram" }).click();
	await expect(sequence).toBeVisible();
	await expect(page.getByTestId("right-panel")).toBeVisible();
	await page.keyboard.press("ControlOrMeta+z");
	await expect(sequence).not.toBeVisible();
});

test("history shortcuts on proposal controls do not invalidate the preview", async ({ page }) => {
	await page.goto("/app");
	await openDocument(page, "tests/fixtures/thf/v1.1-sequence.thf");
	await page.getByRole("button", { name: "New sequence" }).click();
	const interview = await buildOfflineInterview(page);
	const addition = interview.getByRole("checkbox", { name: "Billing worker (element)" });
	await expect(addition).toBeChecked();
	await addition.press("ControlOrMeta+z");
	await addition.press("ControlOrMeta+Shift+z");
	await addition.press("ControlOrMeta+y");
	await interview.getByRole("button", { name: "Apply selected changes" }).click();
	await expect(page.getByRole("heading", { name: "Interview additions applied" })).toBeVisible();
});

test("can undo applied additions from the interview confirmation", async ({ page }) => {
	await page.goto("/app");
	await openDocument(page, "tests/fixtures/thf/v1.1-sequence.thf");
	const interview = await buildOfflineInterview(page);
	await interview.getByRole("button", { name: "Apply selected changes" }).click();
	const confirmation = page.getByRole("region", { name: "Interview additions applied" });
	await expect(confirmation).toBeVisible();
	await page.keyboard.press("ControlOrMeta+z");
	await confirmation.getByRole("button", { name: "Open STRIDE review" }).click();
	const worker = page.locator(".react-flow__node").filter({ hasText: "Billing worker" });
	await expect(worker).toHaveCount(0);
	await page.keyboard.press("ControlOrMeta+Shift+z");
	await expect(worker).toBeVisible();
});

test.describe("cancelled AI request", () => {
	test.use({
		allowedBrowserEvents: [
			{
				channel: "requestfailed",
				pattern: /^POST https:\/\/api\.anthropic\.com\/v1\/messages — net::ERR_ABORTED$/,
			},
		],
	});

	test("cancels interview AI after consent and can still apply the offline proposal", async ({
		page,
	}) => {
		await seedAnthropicApiKey(page);
		let releaseRequest = () => {};
		const paused = new Promise<void>((resolve) => {
			releaseRequest = resolve;
		});
		let requests = 0;
		await page.route("https://api.anthropic.com/v1/messages", async (route) => {
			requests++;
			await paused;
			await route.fulfill({
				status: 200,
				contentType: "text/event-stream",
				body: textResponse('{"questions":["Late suggestion"]}'),
			});
		});
		await page.goto("/app");
		await openDocument(page, "tests/fixtures/thf/v1.1-sequence.thf");
		const interview = await buildOfflineInterview(page);
		await interview.getByRole("button", { name: "Optional AI follow-up" }).click();
		await interview.getByRole("checkbox", { name: "System scope", exact: true }).check();
		const send = interview.getByRole("button", { name: "Send selected answers to Anthropic" });
		expect(requests).toBe(0);
		try {
			const [request] = await Promise.all([
				page.waitForRequest("https://api.anthropic.com/v1/messages"),
				send.click(),
			]);
			expect(JSON.stringify(request.postDataJSON())).not.toContain("Order ID");
			await interview.getByRole("button", { name: "Cancel AI request" }).click();
			await expect(interview.getByRole("status")).toContainText("Request cancelled");
		} finally {
			releaseRequest();
		}
		await expect(interview.getByText("Late suggestion")).toHaveCount(0);
		await interview.getByRole("button", { name: "Apply selected changes" }).click();
		await expect(page.getByRole("heading", { name: "Interview additions applied" })).toBeVisible();
	});
});

test("reviews offline additions, applies once, and hands off to a separate STRIDE review", async ({
	page,
}, testInfo) => {
	await page.goto("/app");
	await openDocument(page, "tests/fixtures/thf/v1.1-sequence.thf");
	const interview = await buildOfflineInterview(page);
	const element = interview.getByRole("checkbox", { name: "Billing worker (element)" });
	const flow = interview.getByRole("checkbox", { name: "Bill order (flow)" });
	await element.uncheck();
	await expect(flow).not.toBeChecked();
	await expect(interview.getByRole("button", { name: "Apply selected changes" })).toBeDisabled();
	await flow.check();
	await expect(element).toBeChecked();
	await interview.getByRole("button", { name: "Apply selected changes" }).click();
	await page.getByRole("button", { name: "Open STRIDE review" }).click();
	const analyze = page.getByRole("button", { name: "Run STRIDE Analysis" });
	await expect(analyze).toBeEnabled();
	const worker = page.locator(".react-flow__node").filter({ hasText: "Billing worker" });
	await expect(worker).toBeVisible();
	await page.keyboard.press("ControlOrMeta+z");
	await expect(worker).toHaveCount(0);
	await page.keyboard.press("ControlOrMeta+Shift+z");
	await expect(worker).toBeVisible();
	const path = testInfo.outputPath("interview.thf");
	await (await saveDocument(page)).saveAs(path);
	expect(await readFile(path, "utf8")).not.toContain("Internal checkout interview");
	await openDocument(page, path);
	await expect(worker).toBeVisible();
	await expect(page.getByRole("button", { name: "Guided interview" })).toBeVisible();
	await analyze.click();
	await expect(page.getByRole("heading", { name: "Threats", exact: true })).toBeVisible();
	await expect(page.getByRole("tab", { name: "Threats" })).toHaveAttribute(
		"aria-description",
		/^[1-9]\d* identified$/,
	);
});
