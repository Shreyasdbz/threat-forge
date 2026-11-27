import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { expect, test } from "./fixtures";
import { openDocument } from "./support/interactions";

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
	await page.reload();
	await expect(
		page.getByRole("tablist", { name: "Open documents" }).getByRole("tab", { selected: true }),
	).toBeVisible();
	expect(await persistedId()).toBe(id);
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
	fixture: string,
	check: (request: (method: string, params: object) => Promise<McpContent[]>) => Promise<void>,
) {
	const child = spawn(binary, [fixture], { stdio: ["pipe", "pipe", "inherit"] });
	const closed = new Promise((resolve) => child.once("close", resolve));
	const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
	let id = 0;
	async function request(method: string, params: object) {
		child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params })}\n`);
		const line = await lines.next();
		expect(line.done, `MCP did not reply to ${method}`).toBeFalsy();
		const response = JSON.parse(line.value);
		expect(response.id).toBe(id);
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
