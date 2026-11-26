import { expect } from "../fixtures";
import { openDocument } from "../support/interactions";
import { canvasCheckpoint, checkpoint, test } from "./checkpoint";

const architecture = "tests/fixtures/thf/architecture-canonical-full.thf";

test("organize an architecture and present the updated diagram", async ({ page }) => {
	await page.goto("/app");
	await openDocument(page, architecture);

	await test.step("Assign an element to a new group", async () => {
		await page.getByTestId("tab-architecture").click();
		const groups = page.getByRole("region", { name: "Groups" });
		await expect(groups.getByText("Inside Backend Cluster")).toBeVisible();
		await groups.getByRole("textbox", { name: "New group name" }).fill("Monitoring");
		await groups.getByRole("button", { name: "Add group" }).click();
		await page
			.getByRole("region", { name: "Layers" })
			.getByRole("button", { name: "Web Application" })
			.click();
		await page
			.getByRole("combobox", { name: "Group", exact: true })
			.selectOption({ label: "Monitoring" });
		await page.getByTestId("tab-architecture").click();
		const monitoring = groups.getByRole("article", { name: "Monitoring" });
		await expect(monitoring.getByRole("button", { name: "Web Application" })).toBeVisible();
		await checkpoint(page, "group-membership", monitoring);
	});

	await test.step("Open the rendered presentation", async () => {
		await page.getByTestId("btn-present").click();
		const presentation = page.getByRole("dialog");
		const preview = presentation.getByRole("img", { name: /^Diagram of/ });
		await expect
			.poll(() => preview.evaluate((image: HTMLImageElement) => image.naturalWidth))
			.toBeGreaterThan(0);
		await checkpoint(page, "presentation", presentation);
	});
});

test.describe("dark theme", () => {
	test.use({ colorScheme: "dark" });

	test("renders the architecture with nested groups", async ({ page }) => {
		await page.goto("/app");
		await openDocument(page, architecture);
		await expect(page.getByTestId("rf__edge-flow-1")).toBeVisible();
		await canvasCheckpoint(page, "dark-nested-groups", 7);
	});
});
