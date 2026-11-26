import { readFile } from "node:fs/promises";
import { expect, test } from "./fixtures";
import { openDocument, saveDocument } from "./support/interactions";
import { buildOfflineInterview } from "./support/interview";

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
