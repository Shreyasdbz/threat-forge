import type { Page } from "@playwright/test";
import {
	addPaletteItem,
	createModel,
	expect,
	test,
	waitForCanvasReady,
	waitForCanvasSettled,
} from "./fixtures";
import { openDocument } from "./support/interactions";

/** Add a trust boundary from the palette (doesn't use node-* testid like elements) */
async function addTrustBoundary(page: Page) {
	// Same readiness gate as addPaletteItem: this helper also double-clicks the palette, so it
	// must not run against a mid-mount canvas (#111).
	await waitForCanvasReady(page);
	const item = page.getByTestId("palette-item-trust-boundary");
	await item.waitFor({ state: "visible" });
	await item.dblclick();
	// Trust boundaries render as ReactFlow nodes but without node-* testid
	// Wait for the boundary to appear in the ReactFlow container
	await page.locator(".react-flow__node-trustBoundary").first().waitFor({ state: "visible" });
}

/**
 * Visual regression tests for the ThreatForge canvas.
 *
 * Uses Playwright's built-in `toHaveScreenshot()` for pixel-level comparison.
 * First run generates baseline images in `e2e/canvas-visual.spec.ts-snapshots/`.
 * Subsequent runs compare against the baseline — failures produce a diff image.
 *
 * Generate and compare baselines in the pinned Playwright image from the E2E job.
 * See docs/runbooks/diagnosing-ci-failures.md for the command and review procedure.
 *
 * NOTE on tests NOT included here:
 *
 * 1. Drag ghost preview: The palette's `setDragGhost()` creates a transient DOM
 *    element at `left:-9999px`, passes it to the native `dataTransfer.setDragImage()`,
 *    then removes it in `requestAnimationFrame`. The browser renders the drag image
 *    outside the DOM as a native overlay — it is not capturable via DOM queries or
 *    Playwright screenshots. Testing this would be inherently flaky/impossible.
 *
 * 2. Trust boundary highlight during drag-over: The boundary wrapper has
 *    `pointer-events: none`, so `dragEnter` events only fire on the 8px-wide
 *    border strip buttons. Coordinating an HTML5 drag from the palette to land
 *    precisely on an 8px strip is extremely fragile across viewport sizes, zoom
 *    levels, and CI environments. The highlight is also conditional on the Zustand
 *    store's `draggedType` being non-null AND non-trust-boundary, which adds
 *    another layer of timing sensitivity. This is better covered by a unit test
 *    on the component's CSS class logic.
 */

test.skip(
	process.env.CANVAS_VISUAL_BASELINES !== "1",
	"Canvas baselines require the pinned Playwright CI image",
);

test.describe("Canvas Visual Regression", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/app");
		await createModel(page);
	});

	test("canvas with single element matches baseline", async ({ page }) => {
		await addPaletteItem(page, "palette-item-web-server");
		await waitForCanvasSettled(page, 1);

		const canvas = page.locator(".react-flow");
		await expect(canvas).toHaveScreenshot("canvas-single-element.png", {
			maxDiffPixelRatio: 0.01,
		});
	});

	test("canvas with multiple element types matches baseline", async ({ page }) => {
		await addPaletteItem(page, "palette-item-web-server");
		await addPaletteItem(page, "palette-item-sql-database");
		await addPaletteItem(page, "palette-item-generic");
		await page.locator(".react-flow__controls-fitview").click();
		await page.locator(".react-flow__controls-zoomout").click();
		await waitForCanvasSettled(page, 3);

		const canvas = page.locator(".react-flow");
		await expect(canvas).toHaveScreenshot("canvas-multiple-elements.png", {
			maxDiffPixelRatio: 0.01,
		});
	});

	test("canvas with trust boundary matches baseline", async ({ page }) => {
		await addTrustBoundary(page);
		await waitForCanvasSettled(page, 1);

		const canvas = page.locator(".react-flow");
		await expect(canvas).toHaveScreenshot("canvas-trust-boundary.png", {
			maxDiffPixelRatio: 0.01,
		});
	});

	test("canvas with elements and trust boundary matches baseline", async ({ page }) => {
		await addTrustBoundary(page);
		await addPaletteItem(page, "palette-item-web-server");
		await addPaletteItem(page, "palette-item-sql-database");
		await page.locator(".react-flow__controls-fitview").click();
		await waitForCanvasSettled(page, 3);
		const nodes = page.locator("[data-testid^='node-']");
		const first = await nodes.nth(0).boundingBox();
		const second = await nodes.nth(1).boundingBox();
		expect(first && second && second.y >= first.y + first.height).toBe(true);

		const canvas = page.locator(".react-flow");
		await expect(canvas).toHaveScreenshot("canvas-elements-with-boundary.png", {
			maxDiffPixelRatio: 0.01,
		});
	});

	test("selected element visual state matches baseline", async ({ page }) => {
		await addPaletteItem(page, "palette-item-web-server");
		await addPaletteItem(page, "palette-item-sql-database");
		await page.locator(".react-flow__controls-fitview").click();

		// Select the first node
		const firstNode = page.locator("[data-testid^='node-']").first();
		await firstNode.click();
		// ReactFlow puts the `selected` class on the node *wrapper*, not on the app's inner
		// `node-*` element, so the state this spec photographs is observable there.
		await expect(page.locator(".react-flow__node.selected")).toHaveCount(1);
		await waitForCanvasSettled(page, 2);

		const canvas = page.locator(".react-flow");
		await expect(canvas).toHaveScreenshot("canvas-selected-element.png", {
			maxDiffPixelRatio: 0.01,
		});
	});
});

for (const colorScheme of ["light", "dark"] as const) {
	test(`selected component inspector matches the ${colorScheme} baseline`, async ({ page }) => {
		await page.emulateMedia({ colorScheme });
		await page.goto("/app");
		await openDocument(page, "tests/fixtures/thf/architecture-canonical-full.thf");
		await page.getByTestId("node-web-app").click();
		const inspector = page.getByTestId("right-panel");
		await expect(inspector.getByRole("heading", { name: "Web Application" })).toBeVisible();
		await expect(inspector).toHaveScreenshot(`inspector-properties-${colorScheme}.png`);
		await page.getByTestId("node-api-gateway").click();
		const appearance = inspector.locator("section").filter({
			has: page.getByRole("heading", { name: "Appearance", exact: true }),
		});
		await expect(appearance.getByLabel("Fill Color", { exact: true })).toHaveValue("#3b82f6");
		await expect(appearance).toHaveScreenshot(`inspector-appearance-${colorScheme}.png`);
	});

	test(`architecture canvas and minimap match the ${colorScheme} baseline`, async ({ page }) => {
		await page.emulateMedia({ colorScheme });
		await page.goto("/app");
		await openDocument(page, "tests/fixtures/thf/architecture-canonical-full.thf");
		await page.getByRole("button", { name: "Show minimap" }).click();
		await page.locator(".react-flow__controls-fitview").click();
		await waitForCanvasSettled(page, 7);
		await expect(page.locator(".react-flow")).toHaveScreenshot(
			`canvas-architecture-${colorScheme}.png`,
			{
				maxDiffPixelRatio: 0.01,
			},
		);
	});
}
