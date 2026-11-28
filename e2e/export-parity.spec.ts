import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { Page } from "@playwright/test";
import { readThreatModelText } from "../src/lib/thf-validation";
import { parseThreatModelYaml, serializeThreatModelYaml } from "../src/lib/thf-yaml";
import type { ThreatModel } from "../src/types/threat-model";
import { expect, test, waitForCanvasReady } from "./fixtures";
import { digest, layoutDigest, scaleFixture } from "./fixtures/gen-scale-workspace.mjs";
import { createDocument, editElementName, openDocument, switchToTab } from "./support/interactions";

test("a browser recovery download retains its import identity and opens in Rust", async ({
	page,
}, testInfo) => {
	const binary = process.env.THREATFORGE_MCP_BINARY;
	test.skip(!binary, "Set THREATFORGE_MCP_BINARY to the built MCP binary.");
	if (!binary) throw new Error("Missing MCP binary");
	const fixture = "tests/fixtures/thf/architecture-canonical-full.thf";
	await page.goto("/app");
	await openDocument(page, fixture);
	await expect(page.getByTestId("local-persistence-status")).toHaveText("Saved locally");
	const persistedId = () =>
		page.evaluate(
			() =>
				JSON.parse(localStorage.getItem("threatforge-workspace") ?? "{}").state.activeDocumentId,
		);
	const id = await persistedId();
	expect(id).toMatch(/^doc-/);
	const initialRevision = await currentRevision(page);
	await page.reload();
	await expect(
		page.getByRole("tablist", { name: "Open documents" }).getByRole("tab", { selected: true }),
	).toBeVisible();
	expect(await persistedId()).toBe(id);
	await waitForCanvasReady(page);
	await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
	await expect(page.getByTestId("local-persistence-status")).toHaveText("Saved locally");
	expect(await currentRevision(page)).toEqual(initialRevision);
	await page.getByRole("button", { name: "Workspace recovery" }).click();
	const download = page.waitForEvent("download");
	await page.getByRole("button", { name: "Download .thf" }).click();
	const exportedPath = testInfo.outputPath("recovered.thf");
	await (await download).saveAs(exportedPath);
	expect(await readFile(exportedPath)).toEqual(await readFile(fixture));
	await withMcp(binary, exportedPath, async (request) => {
		const content = await request("tools/call", { name: "export_markdown", arguments: {} });
		expect(content.some((item) => item.text?.includes("## Components"))).toBe(true);
	});
});

const exports = [
	{
		name: "inline-layout",
		fixture: "tests/fixtures/thf/architecture-canonical-full.thf",
		diagramId: undefined,
	},
	{
		name: "sequence",
		fixture: "tests/fixtures/thf/v1.1-sequence.thf",
		diagramId: "checkout-sequence",
	},
];

async function withMcp(
	binary: string,
	args: string | string[],
	check: (
		request: (method: string, params: object, expectedError?: RegExp) => Promise<McpContent[]>,
	) => Promise<void>,
) {
	const child = spawn(binary, typeof args === "string" ? [args] : args, {
		stdio: ["pipe", "pipe", "inherit"],
	});
	const closed = new Promise((resolve) => child.once("close", resolve));
	const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
	let id = 0;
	async function request(method: string, params: object, expectedError?: RegExp) {
		child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params })}\n`);
		const line = await lines.next();
		expect(line.done, `MCP did not reply to ${method}`).toBeFalsy();
		const response = JSON.parse(line.value);
		expect(response.id).toBe(id);
		if (expectedError) {
			expect(response.error ?? response.result?.isError).toBeTruthy();
			expect(JSON.stringify(response.error ?? response.result.content)).toMatch(expectedError);
			return [];
		}
		expect(response.error).toBeUndefined();
		expect(response.result.isError).not.toBe(true);
		return response.result.content;
	}

	try {
		await once(child, "spawn");
		await request("initialize", {
			protocolVersion: "2025-11-25",
			capabilities: {},
			clientInfo: { name: "export-parity", version: "1" },
		});
		child.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
		await check(request);
	} finally {
		child.stdin.end();
		child.kill();
		await closed;
	}
}

interface McpContent {
	type: string;
	text?: string;
	data?: string;
}

async function currentRevision(page: Page) {
	return page.evaluate(async () => {
		const namespace = "threatforge-workspace";
		const documentId = JSON.parse(localStorage.getItem(namespace) ?? "{}").state.activeDocumentId;
		function read<T>(request: IDBRequest<T>): Promise<T> {
			return new Promise((resolve, reject) => {
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
		}
		const db = await read(indexedDB.open(namespace));
		try {
			const transaction = db.transaction(["documents", "revisions"], "readonly");
			const document = await read(transaction.objectStore("documents").get(documentId));
			const revisions = transaction.objectStore("revisions");
			const result: { documentId: string; seq: number; thf: string } = await read(
				revisions.get(document.currentRevisionId),
			);
			return result;
		} finally {
			db.close();
		}
	});
}

function modelDigest(model: ThreatModel) {
	const { modified: _, ...metadata } = model.metadata;
	return digest({
		...model,
		metadata,
		diagrams: model.diagrams.map(({ viewport: _viewport, ...diagram }) => diagram),
	});
}

test("1k workspace preserves model and layout across browser edits and MCP transactions", async ({
	page,
}, testInfo) => {
	const binary = process.env.THREATFORGE_MCP_BINARY;
	test.skip(!binary, "Set THREATFORGE_MCP_BINARY to the built MCP binary.");
	if (!binary) throw new Error("Missing MCP binary");
	test.slow();

	const { thf, fingerprint } = scaleFixture(1000, "sparse");
	const original = parseThreatModelYaml(thf);
	expect(fingerprint).toMatchObject({
		elements: 1000,
		flows: 250,
		topologyDigest: "2f5b46f4e7fe7cd295de6f6842660ffb4871d23b67a4d4a117acbb6d21fb0156",
		layoutDigest: "f941b8612aabfe0585bb8962c491afe8887cf1d30fd41ba92ced7b73f774bdb8",
	});
	const workspace = testInfo.outputPath("workspace");
	await mkdir(workspace, { recursive: true });
	const path = join(workspace, "scale.thf");
	await writeFile(path, thf);
	await page.setViewportSize({ width: 1024, height: 768 });
	await page.goto("/app");
	await openDocument(page, path);
	await expect(page.locator('[data-testid^="node-bulk-"]')).toHaveCount(996);
	const canvas = page.locator(".react-flow");
	await expect(canvas.locator(".react-flow__edge")).toHaveCount(fingerprint.flows);
	await expect(canvas.locator(".react-flow__viewport")).toHaveCSS("will-change", "auto");
	expect(
		await canvas
			.locator(".react-flow__node, .react-flow__edges > svg")
			.evaluateAll(
				(items) => items.filter((item) => getComputedStyle(item).willChange !== "auto").length,
			),
	).toBe(0);
	await page.getByTestId("tab-architecture").click();
	await expect(page.getByRole("region", { name: "Groups" })).toContainText("Regional service");
	await page.getByRole("combobox", { name: "Diagram view" }).selectOption("order-sequence");
	await expect(page.getByRole("textbox", { name: "Message 1 label" })).toHaveValue(
		"Load storefront",
	);
	await page.getByRole("combobox", { name: "Diagram view" }).selectOption("");
	await page.getByRole("button", { name: "Guided interview" }).click();
	await expect(page.getByRole("region", { name: "Guided interview" })).toBeVisible();
	await page.getByRole("button", { name: "Return to diagram" }).click();

	const status = page.getByTestId("local-persistence-status");
	await expect(status).toHaveText("Saved locally");
	const initial = await currentRevision(page);
	expect(modelDigest(parseThreatModelYaml(initial.thf))).toBe(modelDigest(original));
	const node = page.getByTestId("node-entrypoint");
	await page.getByTestId("tab-properties").click();
	await editElementName(page, node, "Orders client");
	const expectedEdit = structuredClone(original);
	expectedEdit.elements[0].name = "Orders client";
	const checkDraft = async (expected: ThreatModel) => {
		await expect(status).toHaveText("Saved locally");
		const draft = await currentRevision(page);
		expect(draft.documentId).toBe(initial.documentId);
		const model = parseThreatModelYaml(draft.thf);
		expect(modelDigest(model)).toBe(modelDigest(expected));
		expect(layoutDigest(model)).toBe(fingerprint.layoutDigest);
		return draft;
	};
	const firstEdit = await checkDraft(expectedEdit);
	expect(firstEdit.seq).toBe(initial.seq + 1);
	expect(parseThreatModelYaml(firstEdit.thf).diagrams[0].viewport?.zoom).toBeGreaterThan(0);
	await createDocument(page);
	await expect(page.locator('[data-testid^="node-bulk-"]')).toHaveCount(0);
	await expect(page.getByText("Undo: 1 / Redo: 0")).toHaveCount(0);
	await switchToTab(page, { index: 0 });
	await expect(node).toContainText("Orders client");
	const switched = await checkDraft(expectedEdit);
	expect(switched.seq).toBe(firstEdit.seq);
	await node.press("ControlOrMeta+z");
	await expect(node).toContainText("Orders Browser");
	await expect(page.getByText("Undo: 0 / Redo: 1")).toBeVisible();
	const undone = await checkDraft(original);
	expect(undone.seq).toBe(switched.seq + 1);
	expect(parseThreatModelYaml(undone.thf).diagrams[0].viewport).toEqual(
		parseThreatModelYaml(firstEdit.thf).diagrams[0].viewport,
	);
	await node.press("ControlOrMeta+Shift+z");
	await expect(node).toContainText("Orders client");
	await expect(page.getByText("Undo: 1 / Redo: 0")).toBeVisible();
	const edited = await checkDraft(expectedEdit);
	expect(edited.seq).toBe(undone.seq + 1);
	expect(parseThreatModelYaml(edited.thf).diagrams[0].viewport).toEqual(
		parseThreatModelYaml(firstEdit.thf).diagrams[0].viewport,
	);
	await page.reload();
	await expect(node).toContainText("Orders client");
	await waitForCanvasReady(page);
	await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
	expect((await checkDraft(expectedEdit)).seq).toBe(edited.seq);

	const portable = serializeThreatModelYaml(parseThreatModelYaml(edited.thf));
	await writeFile(path, portable);
	let reopenedModel = expectedEdit;
	let markdownDigest = "";
	await withMcp(binary, ["--workspace", workspace], async (request) => {
		async function call(name: string, args: object = {}, error?: RegExp) {
			const content = await request("tools/call", { name, arguments: args }, error);
			return content[0]?.text ?? "";
		}
		await call("open_document", { path: "scale.thf" });
		const readModel = async (): Promise<ThreatModel> => JSON.parse(await call("get_model"));
		expect(modelDigest(await readModel())).toBe(modelDigest(expectedEdit));
		const operations = [
			{ tool: "set_position", arguments: { id: "bulk-0000", x: 1400, y: 144 } },
			{ tool: "set_position", arguments: { id: "bulk-0001", x: 1600, y: 288 } },
		];
		const preview = JSON.parse(await call("batch_transaction", { operations, dry_run: true }));
		expect(preview.results).toHaveLength(2);
		expect(await readFile(path, "utf8")).toBe(portable);
		await call("batch_transaction", { operations, expected_revision: preview.revision });
		const committedBytes = await readFile(path, "utf8");
		const committedModel = parseThreatModelYaml(committedBytes);
		const expectedCommit = structuredClone(expectedEdit);
		for (const {
			arguments: { id, x, y },
		} of operations) {
			const element = expectedCommit.elements.find((entry) => entry.id === id);
			if (!element) throw new Error(`Missing scale fixture element: ${id}`);
			element.position = { x, y };
		}
		expect(layoutDigest(committedModel)).toBe(layoutDigest(expectedCommit));
		expect(modelDigest(committedModel)).toBe(modelDigest(expectedCommit));
		await call(
			"batch_transaction",
			{ operations, expected_revision: preview.revision },
			/changed on disk/i,
		);
		expect(await readFile(path, "utf8")).toBe(committedBytes);
		await call("undo");
		expect(await readFile(path, "utf8")).toBe(portable);
		await call("redo");
		expect(await readFile(path, "utf8")).toBe(committedBytes);
		await call("open_document", { path: "scale.thf" });
		expect(modelDigest(await readModel())).toBe(modelDigest(expectedCommit));
		const markdown = await call("export_markdown");
		expect(markdown).toContain("`Orders client`");
		expect(markdown).toContain("`Service 995`");
		markdownDigest = createHash("sha256").update(markdown).digest("hex");
		expect(await readFile(path, "utf8")).toBe(committedBytes);
		reopenedModel = expectedCommit;
	});
	await openDocument(page, path);
	await expect(node).toContainText("Orders client");
	await expect(page.locator('[data-testid^="node-bulk-"]')).toHaveCount(996);
	await expect(status).toHaveText("Saved locally");
	const reopened = parseThreatModelYaml((await currentRevision(page)).thf);
	expect(modelDigest(reopened)).toBe(modelDigest(reopenedModel));
	expect(layoutDigest(reopened)).toBe(layoutDigest(reopenedModel));
	await page.getByRole("button", { name: "Export", exact: true }).press("Enter");
	const downloading = page.waitForEvent("download");
	await page.getByRole("menuitem", { name: "Export as Markdown" }).click();
	const browserMarkdown = await readFile(await (await downloading).path());
	expect(createHash("sha256").update(browserMarkdown).digest("hex")).toBe(markdownDigest);

	const threats = page.getByTestId("tab-threats");
	await threats.click();
	await page.getByTestId("btn-stride-analyze").click();
	await expect(threats).toHaveAccessibleDescription(/^[1-9]\d* identified$/);
	await expect(status).toHaveText("Saved locally");
	const analyzed = parseThreatModelYaml((await currentRevision(page)).thf);
	await expect(threats).toHaveAccessibleDescription(`${analyzed.threats.length} identified`);
	expect(layoutDigest(analyzed)).toBe(layoutDigest(reopened));
});

test("seeded browser and Rust portable scalar round trips", async () => {
	const binary = process.env.THREATFORGE_MCP_BINARY;
	test.skip(!binary, "Set THREATFORGE_MCP_BINARY to the built MCP binary.");
	if (!binary) throw new Error("Missing MCP binary");
	const workspace = test.info().outputPath("workspace");
	await mkdir(workspace, { recursive: true });
	await withMcp(binary, ["--workspace", workspace], async (request) => {
		const seeds = process.env.THREATFORGE_SCALE_EXTENDED ? [0, 1, 396, 0xffffffff] : [396];
		for (const seed of seeds) {
			await test.step(`seed ${seed}`, async () => {
				const generated = scaleFixture(1000, "sparse", seed);
				const model = readThreatModelText(generated.thf);
				const path = `seed-${seed}.thf`;
				const bytes = serializeThreatModelYaml(model);
				await writeFile(join(workspace, path), bytes);
				await request("tools/call", { name: "open_document", arguments: { path } });
				const content = await request("tools/call", { name: "get_model", arguments: {} });
				expect(modelDigest(JSON.parse(content[0]?.text ?? ""))).toBe(modelDigest(model));
				const invalidPath = `seed-${seed}-invalid.thf`;
				const invalid = bytes.replace(/\bx: 36\b/, "x: not-a-coordinate");
				expect(invalid).not.toBe(bytes);
				expect(() => readThreatModelText(invalid)).toThrow(/position/i);
				await writeFile(join(workspace, invalidPath), invalid);
				await request(
					"tools/call",
					{ name: "open_document", arguments: { path: invalidPath } },
					/The selected file is not a valid ThreatForge document\./,
				);
				expect(await readFile(join(workspace, invalidPath), "utf8")).toBe(invalid);
			});
		}
	});
});

for (const { name, fixture, diagramId } of exports) {
	test(`${name} browser downloads match MCP SVG and PNG bytes`, async ({ page }) => {
		const binary = process.env.THREATFORGE_MCP_BINARY;
		test.skip(!binary, "Set THREATFORGE_MCP_BINARY to the built MCP binary.");
		if (!binary) throw new Error("Missing MCP binary");

		await withMcp(binary, fixture, async (request) => {
			await page.goto("/app");
			await openDocument(page, fixture);
			if (diagramId)
				await page.getByRole("combobox", { name: "Diagram view" }).selectOption(diagramId);
			for (const format of ["SVG", "PNG"] as const) {
				await page.getByTestId("btn-export").click();
				const download = page.waitForEvent("download");
				await page.getByRole("menuitem", { name: `Export as ${format}` }).click();
				const browserBytes = await readFile(await (await download).path());
				const content = await request("tools/call", {
					name: `export_${format.toLowerCase()}`,
					arguments: { diagram_id: diagramId },
				});
				const exported =
					format === "SVG"
						? content.find(({ text }) => text?.startsWith("<svg"))?.text
						: content.find(({ type }) => type === "image")?.data;
				if (!exported) throw new Error(`MCP did not return ${format} data`);
				if (diagramId && format === "SVG") expect(exported).toContain("Submit order");
				const mcpBytes = Buffer.from(exported, format === "SVG" ? "utf8" : "base64");
				expect(browserBytes.equals(mcpBytes), `${format} exports must match byte for byte`).toBe(
					true,
				);
				console.log(
					`${format}: ${browserBytes.length} bytes, SHA-256 ${createHash("sha256").update(browserBytes).digest("hex")}`,
				);
			}
		});
	});
}

for (const name of ["checkout", "hostile"]) {
	test(`${name} browser Markdown download matches MCP and golden bytes`, async ({ page }) => {
		const binary = process.env.THREATFORGE_MCP_BINARY;
		test.skip(!binary, "Set THREATFORGE_MCP_BINARY to the built MCP binary.");
		if (!binary) throw new Error("Missing MCP binary");
		const fixture = `tests/fixtures/markdown/${name}`;
		await withMcp(binary, `${fixture}.thf`, async (request) => {
			await page.goto("/app");
			await openDocument(page, `${fixture}.thf`);
			const trigger = page.getByRole("button", { name: "Export", exact: true });
			await expect(trigger).toBeEnabled();
			await trigger.focus();
			await page.keyboard.press("Enter");
			const downloading = page.waitForEvent("download");
			await page.getByRole("menuitem", { name: "Export as Markdown" }).click();
			const download = await downloading;
			expect(download.suggestedFilename()).toMatch(/\.md$/);
			const browserBytes = await readFile(await download.path());
			const content = await request("tools/call", { name: "export_markdown", arguments: {} });
			expect(content).toHaveLength(1);
			expect(content[0].type).toBe("text");
			expect(content[0].text).toBeDefined();
			const golden = await readFile(`${fixture}.md`);
			expect(Buffer.from(content[0].text ?? "", "utf8")).toEqual(golden);
			expect(browserBytes).toEqual(golden);
		});
	});
}
