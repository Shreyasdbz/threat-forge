import type { Locator } from "@playwright/test";
import { expect, test } from "./fixtures";
import { openDocument } from "./support/interactions";

test.use({ colorScheme: "light" });

test.beforeEach(async ({ page }) => {
	await page.goto("/app");
	await openDocument(page, "tests/fixtures/thf/architecture-canonical-full.thf");
});

test("fits every inspector tab label at the default panel width", async ({ page }) => {
	const tabs = page.getByRole("tablist", { name: "Inspector" }).getByRole("tab");
	await expect(tabs).toHaveCount(4);
	await page.evaluate(() => document.fonts.ready);
	await expect
		.poll(() =>
			tabs.evaluateAll((buttons) =>
				buttons.map((button) => {
					const label = button.lastElementChild;
					if (!label) return false;
					const range = document.createRange();
					range.selectNodeContents(label);
					return (
						range.getClientRects().length === 1 &&
						range.getBoundingClientRect().width <= button.clientWidth &&
						button.clientHeight >= 24
					);
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
	await expect(dot).toHaveCSS("fill", "rgb(174, 185, 200)");
	await page.locator(".react-flow__controls-zoomin").click();
	await expect.poll(diameter).toBeGreaterThan(before);
	expect(Number(await pattern.getAttribute("width")) / (await diameter())).toBeCloseTo(20);
	await page.emulateMedia({ colorScheme: "dark" });
	await expect(dot).toHaveCSS("fill", "rgb(100, 112, 129)");
});

test("uses Inter's optical metrics and kerning for canvas captions", async ({ page }) => {
	const caption = page.getByTestId("node-api-gateway").getByText("dmz / nginx", { exact: true });
	await expect(caption).toHaveCSS("font-kerning", "normal");
	await expect(caption).toHaveCSS("font-optical-sizing", "auto");
	await expect(caption).toHaveCSS("letter-spacing", "normal");
	await expect(caption).toHaveCSS("text-rendering", /geometricprecision/i);
});

test("aligns inspector rows and section headings on the same inset", async ({ page }) => {
	await page.getByTestId("node-web-app").click();
	const panel = page.getByTestId("right-panel");
	const details = panel
		.locator("section")
		.filter({ has: page.getByRole("heading", { name: "Details", exact: true }) });
	const architecture = panel
		.locator("section")
		.filter({ has: page.getByRole("heading", { name: "Architecture", exact: true }) });
	const appearance = panel
		.locator("section")
		.filter({ has: page.getByRole("heading", { name: "Appearance", exact: true }) });
	await expect(architecture.getByRole("textbox", { name: "Technologies" })).toBeVisible();
	await expect(appearance.getByLabel("Fill Color", { exact: true })).toHaveAttribute(
		"type",
		"color",
	);
	await expect(
		appearance.getByRole("spinbutton", { name: "Stroke Color opacity (%)" }),
	).toBeVisible();
	const x = async (locator: Locator) =>
		locator.evaluate(
			(element) =>
				element.getBoundingClientRect().left +
				Number.parseFloat(getComputedStyle(element).paddingLeft),
		);
	const fieldLabel = details.getByText("Name", { exact: true });
	const name = details.getByRole("textbox", { name: "Name", exact: true });
	const id = details.locator("dd");
	expect(await x(fieldLabel)).toBe(await x(details.getByRole("heading")));
	expect(await x(architecture.getByRole("heading"))).toBe(await x(appearance.getByRole("heading")));
	expect(await x(name)).toBeGreaterThan(await x(fieldLabel));
	expect(await x(name)).toBe(await x(id));
	await expect(name).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
	await name.focus();
	await expect(name).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
});

test("insets the compact horizontal canvas controls", async ({ page }) => {
	const controls = page.locator(".react-flow__controls");
	const canvas = page.locator(".react-flow");
	await expect(controls).toBeVisible();
	const controlsBox = await controls.boundingBox();
	const canvasBox = await canvas.boundingBox();
	if (!controlsBox || !canvasBox) throw new Error("Canvas controls are not visible");
	expect(controlsBox.width).toBeGreaterThan(controlsBox.height);
	expect(controlsBox.x - canvasBox.x).toBeCloseTo(16);
	expect(canvasBox.y + canvasBox.height - controlsBox.y - controlsBox.height).toBeCloseTo(16);
});

test("keeps the minimap clear of its toggle on narrow canvases", async ({ page }) => {
	await page.setViewportSize({ width: 768, height: 720 });
	const toggle = page.getByRole("button", { name: "Show minimap" });
	const minimap = page.locator(".react-flow__minimap");
	const controls = page.locator(".react-flow__controls");
	await toggle.click();
	await expect(minimap).toBeVisible();
	const mapBounds = await minimap.boundingBox();
	const controlBounds = await controls.boundingBox();
	if (!mapBounds || !controlBounds) throw new Error("Minimap or canvas controls are hidden");
	expect(mapBounds.y + mapBounds.height).toBeLessThanOrEqual(controlBounds.y);
	await toggle.click();
	await expect(minimap).toHaveCount(0);
});

test("uses the bundled Inter face and equal toolbar icon targets", async ({ page }) => {
	const session = await page.context().newCDPSession(page);
	try {
		await page.evaluate(() => document.fonts.ready);
		await session.send("DOM.enable");
		await session.send("CSS.enable");
		const { root } = await session.send("DOM.getDocument");
		const { nodeId } = await session.send("DOM.querySelector", {
			nodeId: root.nodeId,
			selector: '[data-testid="component-palette"] h2',
		});
		const { fonts } = await session.send("CSS.getPlatformFontsForNode", { nodeId });
		expect(fonts.some((font) => /^Inter\b/.test(font.familyName) && font.isCustomFont)).toBe(true);
	} finally {
		await session.detach();
	}
	const buttons = page
		.getByRole("banner")
		.locator("button[data-testid]")
		.filter({ has: page.locator("svg.lucide") });
	expect(await buttons.count()).toBe(10);
	const metrics = await buttons.evaluateAll((items) =>
		items.map((button) => {
			const { width, height } = button.getBoundingClientRect();
			const svg = button.querySelector("svg");
			const icon = svg?.getBoundingClientRect();
			return [width, height, icon?.width, icon?.height, Number(svg?.getAttribute("stroke-width"))];
		}),
	);
	expect(metrics).toEqual(Array.from({ length: 10 }, () => [32, 32, 16, 16, 2.25]));
});

test("records a focused node's arrow-key movement as a document edit", async ({ page }) => {
	await page.getByTestId("node-web-app").click();
	const node = page.locator(".react-flow__node.selected");
	const initialPosition = await node.evaluate((element) => getComputedStyle(element).transform);
	await node.focus();
	await page.keyboard.press("ArrowRight");
	await expect(node).not.toHaveCSS("transform", initialPosition);
	await expect(page.getByTestId("local-persistence-status")).toHaveAttribute(
		"title",
		/Changes have not been saved to the \.thf file/,
	);
	await page.keyboard.press("Control+z");
	await expect(page.locator('.react-flow__node[data-id="web-app"]')).toHaveCSS(
		"transform",
		initialPosition,
	);
});

test("preserves a focused off-grid node's vertical position on ArrowRight", async ({ page }) => {
	await page.getByTestId("node-web-app").click();
	const node = page.locator('.react-flow__node[data-id="web-app"]');
	const position = () =>
		node.evaluate((element) => {
			const { m41, m42 } = new DOMMatrixReadOnly(getComputedStyle(element).transform);
			return { x: m41, y: m42 };
		});
	const before = await position();
	expect(before.y % 16).not.toBe(0);
	await node.focus();
	await page.keyboard.press("ArrowRight");
	await expect.poll(async () => (await position()).x).toBeGreaterThan(before.x);
	expect((await position()).y).toBe(before.y);
});

test("undoes more than twenty repeats of a held arrow in one step", async ({ page }) => {
	await page.getByTestId("node-web-app").click();
	const node = page.locator('.react-flow__node[data-id="web-app"]');
	const initial = await node.evaluate((element) => getComputedStyle(element).transform);
	await node.focus();
	for (let i = 0; i < 25; i++) await page.keyboard.down("ArrowRight");
	await page.keyboard.up("ArrowRight");
	await expect(node).not.toHaveCSS("transform", initial);
	await page.keyboard.press("Control+z");
	await expect(node).toHaveCSS("transform", initial);
});

test("opens the canvas context menu at the pointer outside layout containment", async ({
	page,
}) => {
	await page.addStyleTag({ content: '[class~="@container/diagram"] { contain: layout; }' });
	const node = page.getByTestId("node-api-gateway");
	await node.evaluate((element) => {
		element.addEventListener(
			"contextmenu",
			(event) => {
				if (event instanceof MouseEvent) {
					element.dataset.testMenuPosition = JSON.stringify([event.clientX, event.clientY]);
				}
			},
			{ once: true },
		);
	});
	await node.click({ button: "right" });
	const pointer = await node.getAttribute("data-test-menu-position");
	const edit = page.getByRole("menuitem", { name: "Edit Properties" });
	await expect(edit).toBeVisible();
	const position = await edit.evaluate((button) => button.parentElement?.getBoundingClientRect());
	expect(JSON.stringify([position?.x, position?.y])).toBe(pointer);
	await edit.click();
	await expect(edit).toHaveCount(0);
});

test("operates the portaled threat and canvas menus from the keyboard", async ({ page }) => {
	await page.getByTestId("tab-threats").click();
	const threat = page.getByTestId("threat-card").first();
	const trigger = threat.getByRole("button").first();
	const linkedElement = threat.getByRole("button").nth(1);
	const copy = page.getByRole("menuitem", { name: "Copy as YAML" });
	await trigger.focus();
	await page.keyboard.press("Shift+F10");
	await expect(copy).toBeFocused();
	await page.keyboard.press("Escape");
	await expect(copy).toHaveCount(0);
	await expect(trigger).toBeFocused();
	await page.keyboard.press("Shift+F10");
	await expect(copy).toBeFocused();
	await page.keyboard.press("Tab");
	await expect(copy).toHaveCount(0);
	await expect(linkedElement).toBeFocused();

	await page.getByTestId("node-api-gateway").click({ button: "right" });
	const edit = page.getByRole("menuitem", { name: "Edit Properties" });
	const remove = page.getByRole("menuitem", { name: "Delete" });
	await expect(edit).toBeFocused();
	await page.keyboard.press("ArrowUp");
	await expect(remove).toBeFocused();
	await page.keyboard.press("ArrowDown");
	await expect(edit).toBeFocused();
	await page.keyboard.press("Escape");
	await expect(edit).toHaveCount(0);
	await expect(page.locator('.react-flow__node[data-id="api-gateway"]')).toBeFocused();
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
