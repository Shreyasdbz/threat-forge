import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentId } from "@/types/document";
import { IndexeddbWorkspaceStorage } from "./indexeddb-workspace-storage";
import { WorkspaceStorageError } from "./types";
import { downloadableRevision, inspectWorkspace } from "./workspace-recovery";

const CLOSED = "doc-closed" as DocumentId;
const CORRUPT = "doc-corrupt" as DocumentId;
const MISSING = "doc-missing" as DocumentId;
const YAML = `version: "1.0"
metadata:
  title: Recovery fixture
  author: Test
  created: "2026-01-01"
  modified: "2026-01-01"
  description: ""
elements: []
data_flows: []
trust_boundaries: []
threats: []
diagrams: []
x-extension: preserved
`;
const missing = {
	id: MISSING,
	title: "Missing document",
	filePath: null,
	order: 0,
	createdAt: "",
	updatedAt: "",
};

describe("workspace recovery inventory", () => {
	beforeEach(() => {
		globalThis.indexedDB = new IDBFactory();
	});

	it("preserves exact stored text and offers the last valid revision without promoting it", async () => {
		const storage = new IndexeddbWorkspaceStorage();
		const invalid = "a: [";
		await storage.writeDocumentBody(CLOSED, YAML);
		await storage.writeDocumentBody(CORRUPT, YAML);
		await storage.writeDocumentBody(CORRUPT, invalid);
		const recovery = await inspectWorkspace(storage, [], [missing]);
		expect(recovery.documents.map(({ status }) => status)).toEqual([
			"missing",
			"closed",
			"corrupt",
		]);
		const [, closed, corrupt] = recovery.documents;
		expect(closed.title).toBe("Recovery fixture");
		expect(downloadableRevision(closed)?.thf).toBe(YAML);
		expect(downloadableRevision(corrupt)?.thf).toBe(YAML);
		expect(corrupt.revisions.map(({ valid }) => valid)).toEqual([true, false]);
		expect(await storage.readDocumentBody(CORRUPT)).toBe(invalid);
	});

	it("returns authored partial inventory when a migration prevents reads", async () => {
		const storage = new IndexeddbWorkspaceStorage();
		vi.spyOn(storage, "listDocuments").mockRejectedValue(
			new WorkspaceStorageError("migration-failed", "private platform detail"),
		);
		const recovery = await inspectWorkspace(storage, [missing], []);
		expect(recovery).toMatchObject({
			unavailable: "migration-failed",
			partial: true,
			documents: [{ id: MISSING, status: "unavailable" }],
		});
		expect(JSON.stringify(recovery)).not.toContain("private platform detail");
	});
});
