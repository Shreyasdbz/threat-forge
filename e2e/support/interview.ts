import type { Page } from "@playwright/test";
import { expect } from "../fixtures";

export async function buildOfflineInterview(page: Page) {
	await page.getByRole("button", { name: "Guided interview" }).click();
	const interview = page.getByRole("region", { name: "Guided interview" });
	const next = interview.getByRole("button", { name: "Continue", exact: true });
	const skip = interview.getByRole("button", { name: "Skip", exact: true });
	await interview
		.getByRole("textbox", { name: "What system are you modeling?" })
		.fill("Internal checkout interview");
	await next.click();
	await interview.getByRole("button", { name: "Add actor or service" }).click();
	await interview.getByRole("textbox", { name: "Actor or service 1 name" }).fill("Billing worker");
	await interview.getByRole("combobox", { name: "Role" }).selectOption("process");
	await next.click();
	await skip.click();
	await interview.getByRole("button", { name: "Add flow", exact: true }).click();
	await interview.getByRole("textbox", { name: "Flow name" }).fill("Bill order");
	await interview.getByRole("combobox", { name: "Source" }).selectOption("existing:checkout");
	await interview
		.getByRole("combobox", { name: "Destination" })
		.selectOption({ label: "Billing worker (new)" });
	await interview.getByRole("textbox", { name: "Data carried (comma separated)" }).fill("Order ID");
	await next.click();
	await interview.getByRole("button", { name: "Review changes" }).click();
	await expect(interview.getByRole("heading", { name: "Proposed additions" })).toBeVisible();
	return interview;
}
