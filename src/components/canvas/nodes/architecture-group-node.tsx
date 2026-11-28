import { type NodeProps, NodeResizeControl } from "@xyflow/react";
import { MoveDiagonal } from "lucide-react";
import { type DfdNode, useCanvasStore } from "@/stores/canvas-store";
import { useUiStore } from "@/stores/ui-store";

export function ArchitectureGroupNode({ id, data }: NodeProps<DfdNode>) {
	const locked = useUiStore((state) => state.canvasLocked);
	const resize = useCanvasStore((state) => state.resizeArchitectureGroup);
	const accent = data.groupAccent
		? `color-mix(in srgb, ${data.groupAccent}, var(--editor-label) var(--editor-container-ink-mix))`
		: undefined;

	return (
		<div
			data-testid={`group-${data.architectureGroupId}`}
			className="group size-full rounded-editor-panel border border-editor-outline"
			style={{
				borderColor: accent
					? `color-mix(in srgb, ${accent} ${Math.min(data.groupStrokeOpacity ?? 0.6, 0.6) * 100}%, transparent)`
					: undefined,
			}}
		>
			<div className="architecture-group-drag-handle pointer-events-auto absolute inset-x-0 top-0 flex cursor-grab items-center gap-2 px-4 py-3 text-editor-footnote text-muted-foreground active:cursor-grabbing">
				<span
					aria-hidden="true"
					className="size-1.5 shrink-0 rounded-full bg-editor-outline"
					style={{ backgroundColor: accent }}
				/>
				<span className="truncate">{data.label}</span>
			</div>
			{!locked && (
				<NodeResizeControl
					minWidth={80}
					minHeight={48}
					maxWidth={4096}
					maxHeight={4096}
					onResizeEnd={(_event, { width, height }) => resize(id, { width, height })}
					className="!pointer-events-auto !border-none !bg-transparent opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
				>
					<MoveDiagonal className="size-4 text-muted-foreground" aria-label="Resize group" />
				</NodeResizeControl>
			)}
		</div>
	);
}
