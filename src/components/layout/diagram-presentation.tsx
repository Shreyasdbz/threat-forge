import { Download, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { type DiagramFormat, renderDiagramSvg, saveDiagram } from "@/lib/export/diagram-export";
import type { ThreatModel } from "@/types/threat-model";

export function DiagramPresentation({
	model,
	diagramId,
	onClose,
}: {
	model: ThreatModel;
	diagramId?: string;
	onClose: () => void;
}) {
	const dialog = useRef<HTMLDialogElement>(null);
	const [image, setImage] = useState<string>();
	const [pending, setPending] = useState<DiagramFormat>();
	const [error, setError] = useState<string>();
	const title = model.diagrams.find(({ id }) => id === diagramId)?.name ?? model.metadata.title;

	useEffect(() => {
		dialog.current?.showModal();
	}, []);

	useEffect(() => {
		let cancelled = false;
		let url: string | undefined;
		void renderDiagramSvg(model, diagramId)
			.then((svg) => {
				if (cancelled) return;
				url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
				setImage(url);
			})
			.catch(() => {
				if (!cancelled) setError("The diagram could not be rendered.");
			});
		return () => {
			cancelled = true;
			if (url) URL.revokeObjectURL(url);
		};
	}, [model, diagramId]);

	async function exportAs(format: DiagramFormat) {
		setPending(format);
		setError(undefined);
		try {
			await saveDiagram(model, format, diagramId);
		} catch {
			setError(`The ${format.toUpperCase()} export could not be saved.`);
		} finally {
			setPending(undefined);
		}
	}

	return (
		<dialog
			ref={dialog}
			aria-labelledby="presentation-title"
			onClose={onClose}
			onKeyDown={(event) => event.stopPropagation()}
			className="fixed inset-0 m-auto h-[calc(100%-2rem)] max-h-none w-[calc(100%-2rem)] max-w-none overflow-hidden rounded-editor-dialog border border-editor-separator bg-editor-raised p-0 text-foreground shadow-editor-dialog backdrop:bg-black/50"
		>
			<div className="flex h-full flex-col">
				<header className="flex shrink-0 flex-wrap items-center gap-4 border-b border-editor-line px-6 py-4">
					<div className="min-w-0 flex-1">
						<p className="text-editor-caption text-editor-secondary-label">Presentation</p>
						<h2 id="presentation-title" className="truncate text-editor-title3">
							{title}
						</h2>
					</div>
					{(["svg", "png"] as const).map((format) => (
						<button
							key={format}
							type="button"
							disabled={!image || pending != null}
							onClick={() => void exportAs(format)}
							className="flex items-center gap-2 rounded-editor-control px-3 py-2 text-editor-body hover:bg-editor-hover disabled:opacity-50"
						>
							<Download className="size-4" aria-hidden="true" />
							Export {format.toUpperCase()}
						</button>
					))}
					<button
						type="button"
						aria-label="Exit presentation"
						title="Exit presentation (Esc)"
						className="rounded-md p-2 hover:bg-accent"
						onClick={() => dialog.current?.close()}
					>
						<X className="size-4" aria-hidden="true" />
					</button>
				</header>
				{error && (
					<p role="alert" className="px-4 py-2 text-editor-body text-destructive">
						{error}
					</p>
				)}
				<div className="grid min-h-0 flex-1 place-items-center overflow-hidden bg-editor-canvas p-8">
					{image ? (
						<img
							src={image}
							alt={`Diagram of ${title}`}
							className="h-full min-h-0 w-full object-contain"
						/>
					) : !error ? (
						<p role="status" className="text-editor-body text-muted-foreground">
							Preparing diagram…
						</p>
					) : null}
				</div>
			</div>
		</dialog>
	);
}
