import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { expect, test } from "./fixtures";
import { openDocument } from "./support/interactions";

const fixture = "tests/fixtures/thf/architecture-canonical-full.thf";

test("inline-layout browser downloads match MCP SVG and PNG bytes", async ({ page }) => {
	const binary = process.env.THREATFORGE_MCP_BINARY;
	test.skip(!binary, "Set THREATFORGE_MCP_BINARY to the built MCP binary.");
	if (!binary) throw new Error("Missing MCP binary");

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

		await page.goto("/app");
		await openDocument(page, fixture);
		await page.getByTestId("btn-present").click();
		const presentation = page.getByRole("dialog");
		for (const format of ["SVG", "PNG"] as const) {
			const download = page.waitForEvent("download");
			await presentation.getByRole("button", { name: `Export ${format}` }).click();
			const browserBytes = await readFile(await (await download).path());
			const content: { type: string; text?: string; data?: string }[] = await request(
				"tools/call",
				{ name: `export_${format.toLowerCase()}`, arguments: {} },
			);
			const exported =
				format === "SVG"
					? content.find(({ text }) => text?.startsWith("<svg"))?.text
					: content.find(({ type }) => type === "image")?.data;
			if (!exported) throw new Error(`MCP did not return ${format} data`);
			const mcpBytes = Buffer.from(exported, format === "SVG" ? "utf8" : "base64");
			expect(browserBytes.equals(mcpBytes), `${format} exports must match byte for byte`).toBe(
				true,
			);
			console.log(
				`${format}: ${browserBytes.length} bytes, SHA-256 ${createHash("sha256").update(browserBytes).digest("hex")}`,
			);
		}
	} finally {
		child.stdin.end();
		child.kill();
		await closed;
	}
});
