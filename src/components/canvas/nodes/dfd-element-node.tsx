import type { NodeProps } from "@xyflow/react";
import { useCallback, useMemo, useRef, useState } from "react";
import { IconRenderer } from "@/components/icons/icon-renderer";
import { useCanvasDraft } from "@/hooks/use-canvas-draft";
import { DEFAULT_NODE_WIDTH } from "@/lib/canvas-utils";
import { resolveComponent, resolveElementIcon } from "@/lib/registry/registry";
import type { ShapeKind } from "@/lib/registry/types";
import { cn } from "@/lib/utils";
import type { DfdNodeData } from "@/stores/canvas-store";
import { useCanvasStore } from "@/stores/canvas-store";
import { useModelStore } from "@/stores/model-store";
import { NodeHandles } from "./shared-handles";
import { ThreatBadge, useThreatCount } from "./threat-badge";

/**
 * Convert a hex color (#rrggbb) + opacity (0-1) to an rgba string.
 * Returns a neutral gray fallback for invalid hex values.
 */
function hexToRgba(hex: string, opacity: number): string {
	if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) {
		return `rgba(136, 136, 136, ${opacity})`;
	}
	const r = Number.parseInt(hex.slice(1, 3), 16);
	const g = Number.parseInt(hex.slice(3, 5), 16);
	const b = Number.parseInt(hex.slice(5, 7), 16);
	return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

/** Shape CSS classes driven by the ShapeKind */
function shapeClass(shape: ShapeKind): string {
	switch (shape) {
		case "database":
			return "rounded-editor-control border-y";
		case "rect":
			return "rounded-editor-control border";
		case "hexagon":
			return "";
		default:
			// rounded
			return "rounded-editor-panel border";
	}
}

export function DfdElementNode({ id, data, selected }: NodeProps) {
	const nodeData = data as DfdNodeData;
	const [isEditing, setIsEditing] = useState(false);
	useCanvasDraft(isEditing);
	const inputRef = useRef<HTMLInputElement>(null);
	const threatCount = useThreatCount(id);

	// Glow when a connected edge is selected
	const connectedToSelectedEdge = useCanvasStore((s) =>
		s.edges.some((e) => e.selected && (e.source === id || e.target === id)),
	);

	const shape = resolveComponent(nodeData.elementType).shape;
	const resolvedIcon = resolveElementIcon({
		type: nodeData.elementType,
		subtype: nodeData.subtype,
		icon: nodeData.icon,
	});

	const fillColor = nodeData.elementFillColor as string | undefined;
	const strokeColor = nodeData.elementStrokeColor as string | undefined;
	const fillOpacity = (nodeData.elementFillOpacity as number | undefined) ?? 0.15;
	const strokeOpacity = (nodeData.elementStrokeOpacity as number | undefined) ?? 1.0;

	const customStyle = useMemo(() => {
		const style: React.CSSProperties = {};
		if (fillColor) {
			style.backgroundColor = hexToRgba(fillColor, fillOpacity);
		}
		if (strokeColor) {
			style.borderColor = hexToRgba(strokeColor, strokeOpacity);
		}
		return style;
	}, [fillColor, strokeColor, fillOpacity, strokeOpacity]);

	const hasCustomColors = Boolean(fillColor || strokeColor);

	const commitLabel = useCallback(
		(value: string) => {
			const trimmed = value.trim();
			if (trimmed && trimmed !== nodeData.label) {
				useModelStore.getState().updateElement(id, { name: trimmed });
				syncNodeLabel(id, trimmed);
			}
			setIsEditing(false);
		},
		[id, nodeData.label],
	);

	const isHexagon = shape === "hexagon";

	const hexBorderColor = strokeColor
		? hexToRgba(strokeColor, strokeOpacity)
		: selected
			? "var(--editor-accent)"
			: "var(--editor-outline)";
	const hexFillColor = fillColor ? hexToRgba(fillColor, fillOpacity) : "var(--editor-surface)";

	const innerContent = (
		<>
			<NodeHandles />

			<div className="min-w-0 text-center">
				{isEditing ? (
					<input
						ref={inputRef}
						defaultValue={nodeData.label}
						autoFocus
						className="w-full bg-transparent text-center text-editor-headline text-foreground outline-none"
						onBlur={(e) => commitLabel(e.target.value)}
						onKeyDown={(e) => {
							e.stopPropagation();
							if (e.key === "Enter") commitLabel(e.currentTarget.value);
							if (e.key === "Escape") setIsEditing(false);
						}}
					/>
				) : (
					<div
						className="flex items-center justify-center gap-2 text-editor-headline text-foreground cursor-text"
						onDoubleClick={() => setIsEditing(true)}
					>
						<IconRenderer icon={resolvedIcon} className="h-4 w-4 shrink-0 text-muted-foreground" />
						<span title={nodeData.label} className="truncate">
							{nodeData.label}
						</span>
					</div>
				)}
				{(nodeData.trustZone || nodeData.technologies.length > 0) && (
					<div className="mt-1 truncate text-editor-caption text-muted-foreground [font-kerning:normal] [font-optical-sizing:auto] [text-rendering:geometricPrecision] tracking-normal">
						{[nodeData.trustZone, nodeData.technologies.join(" · ")].filter(Boolean).join(" / ")}
					</div>
				)}
			</div>

			{threatCount > 0 && <ThreatBadge count={threatCount} />}
		</>
	);

	if (isHexagon) {
		const hexClip = "polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)";

		return (
			<div
				data-testid={`node-${id}`}
				className={cn("relative", nodeData.elementSize && "h-full w-full")}
			>
				{/* Hexagonal fill background */}
				<div
					className="absolute inset-0"
					style={{ clipPath: hexClip, backgroundColor: hexFillColor }}
				/>
				{/* Hexagonal stroke via SVG — CSS border doesn't follow clip-path in WebKit */}
				<svg
					className="absolute inset-0 h-full w-full overflow-visible"
					viewBox="0 0 100 100"
					preserveAspectRatio="none"
					aria-hidden="true"
				>
					<polygon
						points="25,0 75,0 100,50 75,100 25,100 0,50"
						fill="none"
						stroke={hexBorderColor}
						strokeWidth="1.25"
						vectorEffect="non-scaling-stroke"
					/>
				</svg>
				{/* Content — positioned above the fill and stroke layers */}
				<div
					className={cn(
						"group relative flex items-center justify-center px-5 py-3 transition-colors",
						nodeData.elementSize ? "h-full w-full overflow-hidden" : "min-h-[72px]",
					)}
					style={nodeData.elementSize ? undefined : { width: DEFAULT_NODE_WIDTH }}
				>
					{innerContent}
				</div>
			</div>
		);
	}

	return (
		<div
			data-testid={`node-${id}`}
			className={cn(
				"group relative flex items-center justify-center bg-editor-surface px-3 py-2 transition-colors",
				nodeData.elementSize ? "h-full w-full overflow-hidden" : "min-h-[72px]",
				shapeClass(shape),
				!hasCustomColors && (selected ? "border-editor-accent" : "border-editor-outline"),
				hasCustomColors &&
					selected &&
					"ring-2 ring-editor-accent ring-offset-1 ring-offset-editor-canvas",
				connectedToSelectedEdge && !selected && "ring-2 ring-editor-accent/30",
			)}
			style={{ width: nodeData.elementSize ? undefined : DEFAULT_NODE_WIDTH, ...customStyle }}
		>
			{innerContent}
		</div>
	);
}

function syncNodeLabel(elementId: string, name: string) {
	const nodes = useCanvasStore.getState().nodes;
	const updatedNodes = nodes.map((n) =>
		n.id === elementId ? { ...n, data: { ...n.data, label: name } } : n,
	);
	useCanvasStore.setState({ nodes: updatedNodes });
}
