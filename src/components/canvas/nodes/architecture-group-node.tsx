import { type NodeProps, NodeResizeControl } from "@xyflow/react";
import { MoveDiagonal } from "lucide-react";
import { type DfdNode, useCanvasStore } from "@/stores/canvas-store";
import { useUiStore } from "@/stores/ui-store";

export function ArchitectureGroupNode({ id, data }: NodeProps<DfdNode>) {
	const locked = useUiStore((state) => state.canvasLocked);
	const resize = useCanvasStore((state) => state.resizeArchitectureGroup);

	return (
		<div
			data-testid={`group-${data.architectureGroupId}`}
			className="size-full rounded-editor-panel border border-editor-outline"
		>
			<div className="architecture-group-drag-handle pointer-events-auto absolute left-2 top-5 max-w-[calc(100%-1rem)] cursor-grab truncate rounded-editor-control bg-editor-canvas px-2 py-1 text-editor-small font-semibold text-muted-foreground active:cursor-grabbing">
				{data.label}
			</div>
			{!locked && (
				<NodeResizeControl
					minWidth={80}
					minHeight={48}
					maxWidth={4096}
					maxHeight={4096}
					onResizeEnd={(_event, { width, height }) => resize(id, { width, height })}
					className="!pointer-events-auto !border-none !bg-transparent"
				>
					<MoveDiagonal className="size-4 text-muted-foreground" aria-label="Resize group" />
				</NodeResizeControl>
			)}
		</div>
	);
}
