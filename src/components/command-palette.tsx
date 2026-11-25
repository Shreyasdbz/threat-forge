import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFileOperations } from "@/hooks/use-file-operations";
import { buildCommands, type Command, searchCommands } from "@/lib/command-registry";
import { documentDisplayTitle } from "@/lib/document-display-title";
import { useDocumentRegistry } from "@/stores/document-registry";
import { useModelStore } from "@/stores/model-store";
import type { DocumentId } from "@/types/document";

interface CommandPaletteProps {
	open: boolean;
	onClose: () => void;
}

const CATEGORY_LABELS: Record<string, string> = {
	file: "File",
	view: "View",
	canvas: "Canvas",
	navigate: "Navigate",
	settings: "Settings",
	component: "Add Component",
};

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
	const [query, setQuery] = useState("");
	const [selectedIndex, setSelectedIndex] = useState(0);
	const dialogRef = useRef<HTMLDialogElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLDivElement>(null);

	const { newModel, openModel, importModel, saveModel, saveModelAs, closeModel } =
		useFileOperations();
	const hasModel = useModelStore((s) => s.model !== null);
	const openDocumentIds = useDocumentRegistry((s) => s.openDocumentIds);
	const documents = useDocumentRegistry((s) => s.documents);

	// The open documents, in tab order, with a display title read from each document's own store.
	const openDocuments = useMemo(
		() =>
			openDocumentIds.map((id) => {
				const model = documents[id]?.stores.model.getState();
				return { id, title: documentDisplayTitle(model?.model ?? null, model?.filePath ?? null) };
			}),
		[openDocumentIds, documents],
	);

	const switchToDocument = useCallback((id: DocumentId) => {
		useDocumentRegistry.getState().activateDocument(id);
	}, []);

	const stepDocument = useCallback((delta: 1 | -1) => {
		const { openDocumentIds: ids, activeDocumentId } = useDocumentRegistry.getState();
		if (ids.length < 2) return;
		const current = activeDocumentId ? ids.indexOf(activeDocumentId) : 0;
		useDocumentRegistry
			.getState()
			.activateDocument(ids[(current + delta + ids.length) % ids.length]);
	}, []);

	const allCommands = useMemo(
		() =>
			buildCommands({
				newModel: () => void newModel(),
				openModel: () => void openModel(),
				importModel: () => void importModel(),
				saveModel: () => void saveModel(),
				saveModelAs: () => void saveModelAs(),
				hasModel,
				closeDocument: () => void closeModel(),
				nextDocument: () => stepDocument(1),
				previousDocument: () => stepDocument(-1),
				switchToDocument,
				openDocuments,
			}),
		[
			newModel,
			openModel,
			importModel,
			saveModel,
			saveModelAs,
			hasModel,
			closeModel,
			stepDocument,
			switchToDocument,
			openDocuments,
		],
	);

	const filtered = useMemo(() => searchCommands(allCommands, query), [allCommands, query]);

	// Reset state when opened
	useEffect(() => {
		if (open) {
			setQuery("");
			setSelectedIndex(0);
			dialogRef.current?.showModal();
			inputRef.current?.focus();
		}
	}, [open]);

	// Keep selected index in bounds
	useEffect(() => {
		if (selectedIndex >= filtered.length) {
			setSelectedIndex(Math.max(0, filtered.length - 1));
		}
	}, [filtered.length, selectedIndex]);

	// Scroll selected item into view
	useEffect(() => {
		const item = listRef.current?.querySelector(`[data-index="${selectedIndex}"]`);
		item?.scrollIntoView({ block: "nearest" });
	}, [selectedIndex]);

	const executeCommand = useCallback(
		(cmd: Command) => {
			dialogRef.current?.close();
			onClose();
			// Defer execution slightly so the palette closes first
			requestAnimationFrame(() => cmd.action());
		},
		[onClose],
	);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			switch (e.key) {
				case "ArrowDown":
					e.preventDefault();
					setSelectedIndex((i) => (i + 1) % filtered.length);
					break;
				case "ArrowUp":
					e.preventDefault();
					setSelectedIndex((i) => (i - 1 + filtered.length) % filtered.length);
					break;
				case "Enter":
					e.preventDefault();
					if (filtered[selectedIndex]) {
						executeCommand(filtered[selectedIndex]);
					}
					break;
				case "Escape":
					e.preventDefault();
					dialogRef.current?.close();
					onClose();
					break;
			}
		},
		[filtered, selectedIndex, executeCommand, onClose],
	);

	if (!open) return null;

	// Group filtered commands by category for display
	const grouped: { category: string; commands: { cmd: Command; globalIndex: number }[] }[] = [];
	let currentCategory = "";
	for (let i = 0; i < filtered.length; i++) {
		const cmd = filtered[i];
		if (cmd.category !== currentCategory) {
			currentCategory = cmd.category;
			grouped.push({ category: cmd.category, commands: [] });
		}
		grouped[grouped.length - 1].commands.push({ cmd, globalIndex: i });
	}

	return (
		<dialog
			ref={dialogRef}
			aria-label="Command palette"
			className="fixed inset-x-0 top-[16%] mx-auto max-h-[80%] w-[calc(100%-2rem)] max-w-lg overflow-hidden rounded-editor-dialog border border-editor-separator bg-editor-raised p-0 text-foreground shadow-editor-dialog backdrop:bg-black/50"
			data-testid="command-palette"
			onClose={onClose}
			onClick={(event) => {
				if (event.target === event.currentTarget) event.currentTarget.close();
			}}
			onKeyDown={(event) => event.stopPropagation()}
		>
			<div className="flex max-h-[75dvh] flex-col">
				{/* Search input */}
				<div className="flex shrink-0 items-center border-b border-border px-3 focus-within:ring-2 focus-within:ring-inset focus-within:ring-editor-accent">
					<svg
						className="mr-2 h-4 w-4 shrink-0 text-muted-foreground"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
					>
						<title>Search</title>
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							strokeWidth={2}
							d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
						/>
					</svg>
					<input
						ref={inputRef}
						aria-label="Search commands"
						type="text"
						value={query}
						onChange={(e) => {
							setQuery(e.target.value);
							setSelectedIndex(0);
						}}
						onKeyDown={handleKeyDown}
						className="w-full bg-transparent py-3 text-editor-body text-foreground placeholder:text-muted-foreground focus-visible:outline-none"
						placeholder="Type a command…"
						data-testid="command-palette-input"
					/>
				</div>
				{/* Command list */}
				<div ref={listRef} className="max-h-72 overflow-y-auto p-1">
					{filtered.length === 0 && (
						<div className="px-3 py-6 text-center text-editor-body text-muted-foreground">
							No commands found
						</div>
					)}
					{grouped.map((group) => (
						<div key={group.category}>
							<div className="px-3 py-1.5 text-editor-footnote text-muted-foreground">
								{CATEGORY_LABELS[group.category] ?? group.category}
							</div>
							{group.commands.map(({ cmd, globalIndex }) => (
								<button
									key={cmd.id}
									type="button"
									data-index={globalIndex}
									className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-editor-body ${
										globalIndex === selectedIndex
											? "bg-accent text-accent-foreground"
											: "text-foreground hover:bg-accent/50"
									}`}
									onClick={() => executeCommand(cmd)}
									onMouseEnter={() => setSelectedIndex(globalIndex)}
								>
									<span>{cmd.label}</span>
									{cmd.shortcut && (
										<span className="ml-4 text-editor-caption text-muted-foreground">
											{cmd.shortcut}
										</span>
									)}
								</button>
							))}
						</div>
					))}
				</div>
			</div>
		</dialog>
	);
}
