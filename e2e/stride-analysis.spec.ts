import { readFileSync } from "node:fs";
import { parseThreatModelYaml, serializeThreatModelYaml } from "../src/lib/thf-yaml";
import { addPaletteItem, createModel, expect, test } from "./fixtures";

test.describe("STRIDE Analysis", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/app");
		await createModel(page);
	});

	test("STRIDE button is disabled with no elements", async ({ page }) => {
		// Switch to threats tab
		await page.getByTestId("tab-threats").click();
		const btn = page.getByTestId("btn-stride-analyze");
		await expect(btn).toBeVisible();
		await expect(btn).toBeDisabled();
	});

	test("generates threats and copies one as YAML", async ({ page }) => {
		// Add two elements so STRIDE rules can fire
		await addPaletteItem(page, "palette-item-web-server");
		await addPaletteItem(page, "palette-item-sql-database");

		// Switch to threats tab and run analysis
		await page.getByTestId("tab-threats").click();
		const btn = page.getByTestId("btn-stride-analyze");
		await expect(btn).toBeEnabled();
		await btn.click();

		// Wait for threats to appear (analysis is fast for local STRIDE rules).
		// Assert at least 1 threat generated (match 1+ digit, not just "0").
		await expect(page.getByTestId("tab-threats")).toHaveAccessibleDescription(
			/^[1-9]\d* identified$/,
		);

		const threatCard = page.getByTestId("threat-card").first();
		await expect(threatCard).toBeVisible();
		await page.context().grantPermissions(["clipboard-read", "clipboard-write"], {
			origin: "http://localhost:3000",
		});
		await threatCard.click({ button: "right" });
		await page.getByRole("menuitem", { name: "Copy as YAML" }).click();

		const copied = await page.evaluate(() => navigator.clipboard.readText());
		expect(copied).toMatch(/^- id: .+\n/);
		expect(copied).toContain("\n  title: ");
		expect(copied).toContain("\n  category: ");
		expect(copied).not.toContain("\nthreats:");
	});
});

test("virtual findings retain their count, keyboard order, filters and linked selection", async ({
	page,
}) => {
	const model = parseThreatModelYaml(
		readFileSync("tests/fixtures/thf/architecture-canonical-full.thf", "utf8"),
	);
	const count = 300;
	model.threats = Array.from({ length: count }, (_, index) => ({
		id: `finding-${index + 1}`,
		title: `Finding ${index + 1}`,
		category: "Tampering",
		severity: "high",
		description: "",
		...(index === count - 1 && { element: "api-gateway" }),
	}));
	await page.goto("/app");
	const chooser = page.waitForEvent("filechooser");
	await page.getByTestId("btn-open").click();
	await (await chooser).setFiles({
		name: "findings.thf",
		mimeType: "application/yaml",
		buffer: Buffer.from(serializeThreatModelYaml(model)),
	});
	await page.getByTestId("tab-threats").click();
	const list = page.getByRole("list", { name: "Findings" });
	const rows = list.getByRole("listitem");
	const headerName = (position: number) => new RegExp(`^Finding ${position} Tampering high$`, "i");
	const header = (position: number) => list.getByRole("button", { name: headerName(position) });
	const lastRow = rows.filter({ has: page.getByRole("button", { name: headerName(count) }) });
	const first = header(1);
	const last = header(count);
	await expect(first).toBeVisible();
	expect(await rows.count()).toBeLessThan(80);
	await expect(rows.first()).toHaveAttribute("aria-setsize", String(count));
	await expect(rows.first()).toHaveAttribute("aria-posinset", "1");
	await first.focus();
	await page.keyboard.press("Tab");
	await expect(header(2)).toBeFocused();
	await page.keyboard.press("ArrowDown");
	await expect(header(3)).toBeFocused();
	await page.keyboard.press("End");
	await expect(last).toBeFocused();
	await expect(last).toBeInViewport();
	await expect(lastRow).toHaveAttribute("aria-posinset", String(count));
	await expect(lastRow).toHaveAttribute("aria-setsize", String(count));
	await page.keyboard.press("Enter");
	await expect(last).toHaveAttribute("aria-expanded", "true");
	await expect(list.getByRole("textbox", { name: "Title" })).toHaveValue(`Finding ${count}`);
	await page.keyboard.press("Home");
	await expect(first).toBeFocused();
	await expect(first).toBeInViewport();

	await page.getByTestId("node-api-gateway").click();
	await page.getByTestId("tab-properties").click();
	await page.getByRole("button", { name: `Finding ${count}`, exact: true }).click();
	await expect(last).toBeInViewport();
	await expect(last).toHaveAttribute("aria-expanded", "true");
	await page.getByRole("button", { name: "Filter by selected element" }).click();
	await expect(rows).toHaveCount(1);
	await expect(rows.first()).toHaveAttribute("aria-posinset", "1");
	await expect(rows.first()).toHaveAttribute("aria-setsize", "1");
	await expect(last).toHaveAttribute("aria-expanded", "true");
	await page.getByRole("button", { name: /Showing threats for/ }).click();
	await expect(last).toBeInViewport();
	await expect(lastRow).toHaveAttribute("aria-setsize", String(count));
	expect(await rows.count()).toBeLessThan(80);
});
