import { expect } from "../fixtures";
import { openDocument } from "../support/interactions";
import { buildOfflineInterview } from "../support/interview";
import { checkpoint, test } from "./checkpoint";

test("review an offline interview then analyze the applied model", async ({ page }) => {
	await page.goto("/app");
	await openDocument(page, "tests/fixtures/thf/v1.1-sequence.thf");
	const interview = await buildOfflineInterview(page);
	const inspector = page.getByTestId("right-panel");

	await test.step("Review the direction, dependency, and unanswered questions", async () => {
		await expect(interview.getByText("Checkout → Billing worker · Order ID")).toBeVisible();
		await expect(interview.getByText("Requires: Billing worker")).toBeVisible();
		await expect(interview.getByText("Stores not answered.")).toBeVisible();
		await page.mouse.move(0, 0);
		await checkpoint(page, "offline-interview-proposal", interview);
	});

	await test.step("Apply the proposed additions and review STRIDE findings", async () => {
		await interview.getByRole("button", { name: "Apply selected changes" }).click();
		await page.getByRole("button", { name: "Open STRIDE review" }).click();
		await inspector.getByRole("button", { name: "Run STRIDE Analysis" }).click();
		await expect(inspector.getByRole("tab", { name: "Threats" })).toHaveAttribute(
			"aria-description",
			/^[1-9]\d* identified$/,
		);
		await page.mouse.move(0, 0);
		await checkpoint(page, "post-interview-stride", inspector);
	});
});
