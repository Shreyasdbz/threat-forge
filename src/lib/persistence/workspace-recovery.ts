import { downloadBlob } from "@/lib/adapters/browser-file-adapter";
import { sanitizeDisplayText } from "@/lib/document-display-title";
import { readThreatModelText } from "@/lib/thf-validation";
import type { DocumentId } from "@/types/document";
import type { WorkspaceManifestEntry, WorkspaceUnavailableReason } from "./types";
import { WorkspaceStorageError } from "./types";
import type { WorkspaceStorage } from "./workspace-storage";

interface RecoveryRevision {
	thf: string;
	valid: boolean;
}

export interface RecoveryDocument {
	id: DocumentId;
	title: string;
	status: "stored" | "closed" | "missing" | "corrupt" | "unavailable";
	current: RecoveryRevision | null;
	revisions: RecoveryRevision[];
}

export interface WorkspaceRecovery {
	documents: RecoveryDocument[];
	unavailable: WorkspaceUnavailableReason | null;
	partial: boolean;
}

function inspectRevision(thf: unknown): RecoveryRevision | null {
	if (typeof thf !== "string") return null;
	try {
		readThreatModelText(thf);
		return { thf, valid: true };
	} catch {
		return { thf, valid: false };
	}
}

export function downloadableRevision(document: RecoveryDocument): RecoveryRevision | undefined {
	if (document.current?.valid) return document.current;
	for (let index = document.revisions.length - 1; index >= 0; index--) {
		if (document.revisions[index].valid) return document.revisions[index];
	}
	return undefined;
}

export async function inspectWorkspace(
	storage: WorkspaceStorage,
	activeEntries: readonly WorkspaceManifestEntry[],
	missingEntries: readonly WorkspaceManifestEntry[],
): Promise<WorkspaceRecovery> {
	const entries = new Map([...missingEntries, ...activeEntries].map((entry) => [entry.id, entry]));
	let ids: DocumentId[];
	try {
		ids = (await storage.listDocuments()).map(({ id }) => id);
	} catch (error) {
		const kind = error instanceof WorkspaceStorageError ? error.kind : null;
		const unavailable =
			kind === "migration-failed" || kind === "private-mode" || kind === "corrupt"
				? kind
				: "unavailable";
		return {
			partial: true,
			unavailable,
			documents: Array.from(entries.values(), ({ id, title }) => ({
				id,
				title,
				status: "unavailable",
				current: null,
				revisions: [],
			})),
		};
	}

	const active = new Set(activeEntries.map(({ id }) => id));
	const stored = new Set(ids);
	let partial = false;
	const documents: RecoveryDocument[] = [];
	for (const id of new Set([...entries.keys(), ...ids])) {
		let current: RecoveryRevision | null = null;
		let revisions: RecoveryRevision[] = [];
		let status: RecoveryDocument["status"] = "missing";
		if (stored.has(id)) {
			const [head, history] = await Promise.allSettled([
				storage.readDocumentBody(id),
				storage.listRevisions(id),
			]);
			if (head.status === "fulfilled") current = inspectRevision(head.value);
			if (history.status === "fulfilled") {
				revisions = history.value.flatMap(({ thf }) => inspectRevision(thf) ?? []);
				if (revisions.length !== history.value.length) partial = true;
			} else {
				partial = true;
			}
			if (
				head.status === "rejected" &&
				!(head.reason instanceof WorkspaceStorageError && head.reason.kind === "corrupt")
			) {
				partial = true;
				status = "unavailable";
			} else {
				status = current?.valid ? (active.has(id) ? "stored" : "closed") : "corrupt";
			}
		}
		const document = { id, status, current, revisions, title: entries.get(id)?.title ?? "" };
		const revision = downloadableRevision(document);
		document.title ||= revision ? readThreatModelText(revision.thf).metadata.title : "Untitled";
		documents.push(document);
	}
	return { documents, unavailable: null, partial };
}

export function downloadStoredDocument(document: RecoveryDocument): void {
	const revision = downloadableRevision(document);
	if (!revision) return;
	const filename = sanitizeDisplayText(document.title)
		.replace(/[^\p{L}\p{N}_-]+/gu, "-")
		.slice(0, 80);
	downloadBlob(
		new Blob([revision.thf], { type: "application/x-yaml" }),
		`${filename || "document"}.thf`,
	);
}

export function downloadWorkspaceRecovery(recovery: WorkspaceRecovery): void {
	const body = JSON.stringify(
		{ format: "threatforge-workspace-recovery", version: 1, ...recovery },
		null,
		2,
	);
	downloadBlob(
		new Blob([`${body}\n`], { type: "application/json" }),
		"threatforge-workspace-recovery.json",
	);
}
