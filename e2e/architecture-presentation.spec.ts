import { readFile } from "node:fs/promises";
import { expect, test } from "./fixtures";
import { openDocument } from "./support/interactions";

test("browses architecture memberships, then presents and exports the shared diagram", async ({
	page,
}) => {
	await page.goto("/app");
	await openDocument(page, "tests/fixtures/thf/architecture-canonical-full.thf");
	await expect(page.getByTestId("rf__edge-flow-1")).toBeVisible();
	await page.getByTestId("tab-architecture").click();
	const layers = page.getByRole("region", { name: "Layers" });
	const groups = page.getByRole("region", { name: "Groups" });
	await expect(layers.getByRole("button", { name: "Web Application" })).toBeVisible();
	await expect(groups.getByText("Inside Backend Cluster")).toBeVisible();

	await groups.getByRole("textbox", { name: "New group name" }).fill("Monitoring");
	await groups.getByRole("button", { name: "Add group" }).click();
	await expect(groups.getByRole("heading", { name: "Monitoring" })).toBeVisible();
	await layers.getByRole("button", { name: "Web Application" }).click();
	await page
		.getByRole("combobox", { name: "Group", exact: true })
		.selectOption({ label: "Monitoring" });
	await expect(page.getByRole("heading", { name: "Web Application" })).toBeVisible();
	await page.getByTestId("tab-architecture").click();
	await expect(
		groups
			.getByRole("article", { name: "Monitoring" })
			.getByRole("button", { name: "Web Application" }),
	).toBeVisible();

	await page.getByTestId("btn-present").click();
	const presentation = page.getByRole("dialog");
	const preview = presentation.getByRole("img", { name: /^Diagram of/ });
	await expect(preview).toBeVisible();
	await expect
		.poll(() => preview.evaluate((image: HTMLImageElement) => image.naturalWidth))
		.toBeGreaterThan(0);
	for (const format of ["SVG", "PNG"]) {
		const download = page.waitForEvent("download");
		await presentation.getByRole("button", { name: `Export ${format}` }).click();
		const file = await download;
		expect(file.suggestedFilename()).toMatch(new RegExp(`\\.${format.toLowerCase()}$`));
		const bytes = await readFile(await file.path());
		if (format === "SVG") {
			const svg = bytes.toString("utf8");
			expect(svg).toContain("Web Application");
			expect(svg).toContain('fill="#f7f8fa"');
			expect(svg).toContain('font-size="14" font-weight="600"');
			expect(svg).toContain('fill="none" fill-opacity="0.000" stroke="#15803d"');
			expect(svg).toContain('fill="#22c55e" fill-opacity="0.003" stroke="#15803d"');
			const position = (label: string) =>
				svg.match(new RegExp(`<text (x="[^"]+" y="[^"]+")[^>]*>${label}</text>`))?.[1];
			expect(position("Persist order")).toBeDefined();
			expect(position("Runs alongside")).toBeDefined();
			expect(position("Persist order")).not.toBe(position("Runs alongside"));
		} else expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
	}
	await page.keyboard.press("Escape");
	await expect(presentation).toBeHidden();
	await expect(page.getByTestId("btn-present")).toBeFocused();
});
