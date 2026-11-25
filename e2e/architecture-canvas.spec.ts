import { expect, test } from "./fixtures";
import { openDocument } from "./support/interactions";

test.beforeEach(async ({ page }) => {
	await page.goto("/app");
	await openDocument(page, "tests/fixtures/thf/architecture-canonical-full.thf");
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
	await expect(
		minimap.locator('.react-flow__minimap-node[style*="fill: transparent"]'),
	).toHaveCount(4);
	await expect(
		minimap.locator('.react-flow__minimap-node[style*="fill: var(--color-primary)"]'),
	).toHaveCount(3);
});
