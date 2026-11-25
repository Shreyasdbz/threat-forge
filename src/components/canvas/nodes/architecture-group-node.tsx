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
			className="size-full rounded-lg border border-primary/40 bg-primary/[0.035]"
		>
			<div className="architecture-group-drag-handle pointer-events-auto absolute left-1 top-5 max-w-[calc(100%-0.5rem)] cursor-grab truncate rounded bg-card px-2 py-0.5 text-xs font-medium text-primary active:cursor-grabbing">
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
					<MoveDiagonal className="size-4 text-primary" aria-label="Resize group" />
				</NodeResizeControl>
			)}
		</div>
	);
}
