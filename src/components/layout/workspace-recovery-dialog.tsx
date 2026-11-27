import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { clearStoredWorkspace } from "@/hooks/use-workspace-persistence";
import { hydrateDocumentById } from "@/hooks/use-workspace-restore";
import { sanitizeDisplayText } from "@/lib/document-display-title";
import { getWorkspaceStorage } from "@/lib/persistence/get-workspace-storage";
import {
	downloadableRevision,
	downloadStoredDocument,
	downloadWorkspaceRecovery,
	inspectWorkspace,
	type RecoveryDocument,
	type WorkspaceRecovery,
} from "@/lib/persistence/workspace-recovery";
import { useWorkspaceStore } from "@/stores/workspace-store";

const STATUS_LABELS: Record<RecoveryDocument["status"], string> = {
	stored: "Saved locally",
	closed: "Stored without an open tab",
	missing: "Tab metadata only — stored document missing",
	corrupt: "Current stored document is unreadable",
	unavailable: "Stored document could not be checked",
};

async function loadRecovery(): Promise<WorkspaceRecovery> {
	const storage = await getWorkspaceStorage();
	const { documents, missingDocuments } = useWorkspaceStore.getState();
	return inspectWorkspace(storage, documents, missingDocuments ?? []);
}

export function WorkspaceRecoveryDialog({ onClose }: { onClose: () => void }) {
	const dialog = useRef<HTMLDialogElement>(null);
	const title = useId();
	const [recovery, setRecovery] = useState<WorkspaceRecovery>();
	const [busy, setBusy] = useState(false);
	const [status, setStatus] = useState("");
	const [error, setError] = useState("");

	useEffect(() => {
		dialog.current?.showModal();
		let cancelled = false;
		void loadRecovery().then(
			(result) => {
				if (!cancelled) setRecovery(result);
			},
			() => {
				if (!cancelled) setError("Workspace storage could not be checked.");
			},
		);
		return () => {
			cancelled = true;
		};
	}, []);

	async function clear(document?: RecoveryDocument) {
		const label = document ? sanitizeDisplayText(document.title) : "";
		const confirmed = window.confirm(
			document
				? `Permanently clear the stored copy and revisions for “${label}” and close its tab? This cannot be undone.`
				: "Permanently clear every browser workspace document, including open tabs and stored revisions? This cannot be undone.",
		);
		if (!confirmed) return;
		setBusy(true);
		setError("");
		setStatus("Clearing workspace storage…");
		try {
			await clearStoredWorkspace(document?.id ?? null, () =>
				setStatus("Close other Threat Forge tabs to finish clearing this workspace."),
			);
			setRecovery(await loadRecovery());
			setStatus(document ? "Stored document cleared." : "Browser workspace cleared.");
		} catch {
			setStatus("");
			setError("Workspace storage could not be cleared.");
		} finally {
			setBusy(false);
		}
	}

	async function reopen(document: RecoveryDocument) {
		setBusy(true);
		setError("");
		try {
			if (await hydrateDocumentById(document.id)) {
				dialog.current?.close();
				return;
			}
			setError("This document could not be reopened.");
		} finally {
			setBusy(false);
		}
	}

	return (
		<dialog
			ref={dialog}
			aria-labelledby={title}
			onClose={onClose}
			onKeyDown={(event) => event.stopPropagation()}
			onCancel={(event) => {
				if (busy) event.preventDefault();
			}}
			className="fixed inset-0 m-auto max-h-[calc(100%-2rem)] w-[calc(100%-2rem)] max-w-2xl overflow-auto rounded-editor-dialog border border-editor-separator bg-editor-raised p-6 text-foreground shadow-editor-dialog backdrop:bg-black/50"
		>
			<header className="mb-4 flex flex-wrap items-start justify-between gap-2">
				<div>
					<h2 id={title} className="text-editor-title3">
						Workspace recovery
					</h2>
					<p className="text-editor-footnote text-muted-foreground">
						Recover or export documents saved in this browser.
					</p>
				</div>
				<Button
					type="button"
					variant="ghost"
					disabled={busy}
					onClick={() => dialog.current?.close()}
				>
					Close
				</Button>
			</header>
			<div role="status" className="text-editor-footnote">
				{status || (!recovery && !error ? "Checking workspace storage…" : "")}
			</div>
			{error && (
				<p role="alert" className="text-editor-footnote text-destructive">
					{error}
				</p>
			)}
			{recovery && (
				<>
					{recovery.unavailable && (
						<p role="alert" className="mb-3 text-editor-footnote text-destructive">
							{recovery.unavailable === "migration-failed"
								? "The browser workspace could not be upgraded. No stored documents were deleted. Try reopening in an up-to-date copy of Threat Forge before clearing storage."
								: "Browser workspace storage could not be read. Data that could not be read is not in the recovery bundle."}
						</p>
					)}
					<Button
						type="button"
						variant="outline"
						className="mb-4"
						disabled={busy}
						onClick={() => downloadWorkspaceRecovery(recovery)}
					>
						{recovery.partial ? "Download partial recovery bundle" : "Download recovery bundle"}
					</Button>
					{recovery.documents.length ? (
						<ul className="divide-y divide-editor-line">
							{recovery.documents.map((document) => (
								<li
									key={document.id}
									className="flex flex-wrap items-center justify-between gap-2 py-2"
								>
									<div className="min-w-0 break-words">
										<p className="text-editor-body">
											{sanitizeDisplayText(document.title) || "Untitled"}
										</p>
										<p className="text-editor-caption text-muted-foreground">
											{STATUS_LABELS[document.status]}
										</p>
									</div>
									<div className="flex flex-wrap gap-2">
										{document.current?.valid && (
											<Button
												type="button"
												variant="outline"
												size="sm"
												disabled={busy}
												onClick={() => void reopen(document)}
											>
												Open
											</Button>
										)}
										{downloadableRevision(document) && (
											<Button
												type="button"
												variant="outline"
												size="sm"
												disabled={busy}
												onClick={() => downloadStoredDocument(document)}
											>
												{document.current?.valid ? "Download .thf" : "Download last valid .thf"}
											</Button>
										)}
										<Button
											type="button"
											variant="ghost"
											size="sm"
											disabled={busy || !!recovery.unavailable}
											onClick={() => void clear(document)}
										>
											Clear…
										</Button>
									</div>
								</li>
							))}
						</ul>
					) : (
						!recovery.unavailable && (
							<p className="text-editor-footnote text-muted-foreground">
								No browser documents are stored.
							</p>
						)
					)}
					<footer className="mt-4 flex justify-end border-t border-editor-line pt-4">
						<Button
							type="button"
							variant="ghost"
							className="text-destructive-foreground hover:text-destructive-foreground"
							disabled={busy}
							onClick={() => void clear()}
						>
							Clear browser workspace…
						</Button>
					</footer>
				</>
			)}
		</dialog>
	);
}
