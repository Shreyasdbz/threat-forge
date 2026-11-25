import { expect, test } from "./fixtures";
import { openDocument } from "./support/interactions";

test.use({ colorScheme: "light" });

test.beforeEach(async ({ page }) => {
	await page.goto("/app");
	await openDocument(page, "tests/fixtures/thf/architecture-canonical-full.thf");
});

test("fits every inspector tab label at the default panel width", async ({ page }) => {
	const tabs = page.getByTestId("right-panel").locator("button[aria-pressed]");
	await expect(tabs).toHaveCount(4);
	await page.evaluate(() => document.fonts.ready);
	await expect
		.poll(() =>
			tabs.evaluateAll((buttons) =>
				buttons.map((button) => {
					const label = button.lastElementChild;
					return Boolean(label?.clientWidth && label.scrollWidth <= label.clientWidth);
				}),
			),
		)
		.toEqual([true, true, true, true]);
});

test("renders the neutral dot grid at a consistent diagram-space scale", async ({ page }) => {
	const dot = page.getByTestId("rf__background").locator("circle");
	const pattern = page.getByTestId("rf__background").locator("pattern");
	await expect(dot).toBeAttached();
	const diameter = async () => Number(await dot.getAttribute("r")) * 2;
	const before = await diameter();
	await expect(dot).toHaveCSS("fill", "rgb(196, 203, 213)");
	await page.locator(".react-flow__controls-zoomin").click();
	await expect.poll(diameter).toBeGreaterThan(before);
	expect(Number(await pattern.getAttribute("width")) / (await diameter())).toBeCloseTo(20);
});

test("moves and resizes a group outline independently of its members, with undo", async ({
	page,
}) => {
	const group = page.getByTestId("group-frontend-cluster");
	const member = page.getByTestId("node-web-app");
	await expect(group).toBeVisible();
	const initial = await group.boundingBox();
	const memberInitial = await member.boundingBox();
	if (!initial || !memberInitial) throw new Error("Expected visible group and member");

	const drag = async (x: number, y: number, dx: number, dy: number) => {
		await page.mouse.move(x, y);
		await page.mouse.down();
		await page.mouse.move(x + dx, y + dy, { steps: 8 });
		await page.mouse.up();
	};
	const title = await group.getByText("Frontend Cluster", { exact: true }).boundingBox();
	if (!title) throw new Error("Expected group title");
	await drag(title.x + title.width / 2, title.y + title.height / 2, 32, 32);
	await expect
		.poll(async () => (await group.boundingBox())?.x ?? 0)
		.toBeGreaterThan(initial.x + 10);
	expect(await member.boundingBox()).toEqual(memberInitial);

	const handle = await group.getByLabel("Resize group").boundingBox();
	if (!handle) throw new Error("Expected resize handle");
	const resizeIcon = group.getByLabel("Resize group").locator("..");
	await page.mouse.move(0, 0);
	await expect(resizeIcon).toHaveCSS("opacity", "0");
	await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
	await expect(resizeIcon).toHaveCSS("opacity", "1");
	await drag(handle.x + handle.width / 2, handle.y + handle.height / 2, 40, 32);
	await expect
		.poll(async () => (await group.boundingBox())?.width ?? 0)
		.toBeGreaterThan(initial.width + 10);

	await page.keyboard.press("Control+z");
	await expect.poll(async () => (await group.boundingBox())?.width).toBeCloseTo(initial.width);
	await page.keyboard.press("Control+z");
	await expect.poll(async () => (await group.boundingBox())?.x).toBeCloseTo(initial.x);
});

test("keeps flow cards clear of nodes and distinguishes groups from components in the minimap", async ({
	page,
}) => {
	const label = page.getByTestId("flow-label-flow-2");
	const node = page.getByTestId("node-api-gateway");
	await expect(label).toBeVisible();
	await expect(node.getByText("API Gateway", { exact: true })).toBeVisible();
	await expect
		.poll(async () => {
			const a = await label.boundingBox();
			const b = await node.boundingBox();
			return (
				!!a &&
				!!b &&
				(a.x + a.width <= b.x ||
					b.x + b.width <= a.x ||
					a.y + a.height <= b.y ||
					b.y + b.height <= a.y)
			);
		})
		.toBe(true);
	const minimap = page.locator(".react-flow__minimap");
	const toggle = page.getByRole("button", { name: "Show minimap" });
	await expect(minimap).toHaveCount(0);
	await toggle.click();
	await expect(toggle).toHaveAttribute("aria-pressed", "true");
	await expect(
		minimap.locator('.react-flow__minimap-node[style*="fill: transparent"]'),
	).toHaveCount(4);
	await expect(minimap.locator(".react-flow__minimap-node").first()).toHaveCSS(
		"vector-effect",
		"non-scaling-stroke",
	);
	await expect(minimap.locator('.react-flow__minimap-node[style*="fill: color-mix"]')).toHaveCount(
		3,
	);
	await toggle.click();
	await expect(minimap).toHaveCount(0);
});
