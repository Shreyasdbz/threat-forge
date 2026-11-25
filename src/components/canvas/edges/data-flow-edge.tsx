import {
	BaseEdge,
	EdgeLabelRenderer,
	type EdgeProps,
	getBezierPath,
	useReactFlow,
	useViewport,
} from "@xyflow/react";
import { Lock, Plus } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { nodeToRect } from "@/lib/canvas-utils";
import { cn } from "@/lib/utils";
import { type DfdEdgeData, useCanvasStore } from "@/stores/canvas-store";
import { useHistoryStore } from "@/stores/history-store";
import { useModelStore } from "@/stores/model-store";
import { useUiStore } from "@/stores/ui-store";
import type { ThreatModel } from "@/types/threat-model";

function clearLabelPosition(
	x: number,
	y: number,
	width: number,
	height: number,
	nodes: ReturnType<typeof nodeToRect>[],
	fallback?: { x: number; y: number },
) {
	const overlaps = (cx: number, cy: number, node: ReturnType<typeof nodeToRect>) =>
		cx + width / 2 + 6 > node.x &&
		cx - width / 2 - 6 < node.x + node.width &&
		cy + height / 2 + 6 > node.y &&
		cy - height / 2 - 6 < node.y + node.height;
	const blocking = nodes.filter((node) => overlaps(x, y, node));
	if (!blocking.length) return { x, y };
	if (fallback && !nodes.some((node) => overlaps(fallback.x, fallback.y, node))) return fallback;

	const outside = (rects: typeof nodes) => [
		{ x: Math.min(...rects.map((node) => node.x)) - width / 2 - 7, y },
		{ x: Math.max(...rects.map((node) => node.x + node.width)) + width / 2 + 7, y },
		{ x, y: Math.min(...rects.map((node) => node.y)) - height / 2 - 7 },
		{ x, y: Math.max(...rects.map((node) => node.y + node.height)) + height / 2 + 7 },
	];
	return (
		[...outside(blocking), ...outside(nodes)]
			.sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))
			.find((point) => !nodes.some((node) => overlaps(point.x, point.y, node))) ?? { x, y }
	);
}

/**
 * Build a quadratic bezier from source to target that passes through the waypoint.
 * For a quadratic bezier B(t) = (1-t)²S + 2t(1-t)C + t²T,
 * solving B(0.5) = W gives C = 2W - (S+T)/2.
 */
function getWaypointPath(
	sx: number,
	sy: number,
	tx: number,
	ty: number,
	wx: number,
	wy: number,
): string {
	const cx = 2 * wx - (sx + tx) / 2;
	const cy = 2 * wy - (sy + ty) / 2;
	return `M ${sx},${sy} Q ${cx},${cy} ${tx},${ty}`;
}

export function DataFlowEdge({
	id,
	source,
	target,
	sourceX,
	sourceY,
	targetX,
	targetY,
	sourcePosition,
	targetPosition,
	data,
	selected,
	markerEnd,
}: EdgeProps) {
	const edgeData = data as DfdEdgeData | undefined;
	const { setEdges } = useReactFlow();
	const nodes = useCanvasStore((state) => state.nodes);
	const { obstacles, midpoint } = useMemo(() => {
		const byId = new Map(nodes.map((node) => [node.id, node]));
		const rects = new Map(
			nodes
				.filter((node) => !node.data.isBoundary && node.type !== "architectureGroup")
				.map((node) => {
					const rect = nodeToRect(node);
					const parent = node.parentId ? byId.get(node.parentId) : undefined;
					return [
						node.id,
						parent
							? { ...rect, x: rect.x + parent.position.x, y: rect.y + parent.position.y }
							: rect,
					] as const;
				}),
		);
		const a = rects.get(source);
		const b = rects.get(target);
		const midpoint =
			a && b && source !== target
				? {
						x: (a.x + a.width / 2 + b.x + b.width / 2) / 2,
						y: (a.y + a.height / 2 + b.y + b.height / 2) / 2,
					}
				: undefined;
		return { obstacles: [...rects.values()], midpoint };
	}, [nodes, source, target]);

	const isSelfLoop = source === target;

	// Self-loop: custom cubic bezier path that arcs out from the node
	const selfLoopOffset = 70;
	const selfLoopPath = isSelfLoop
		? `M ${sourceX},${sourceY} C ${sourceX + selfLoopOffset},${sourceY - selfLoopOffset} ${targetX + selfLoopOffset},${targetY - selfLoopOffset} ${targetX},${targetY}`
		: "";
	const selfLoopLabelX = isSelfLoop ? sourceX + selfLoopOffset * 0.8 : 0;
	const selfLoopLabelY = isSelfLoop ? sourceY - selfLoopOffset * 0.8 : 0;

	// Default label position (midpoint of standard bezier)
	const [defaultPath, defaultLabelX, defaultLabelY] = isSelfLoop
		? [selfLoopPath, selfLoopLabelX, selfLoopLabelY]
		: getBezierPath({
				sourceX,
				sourceY,
				sourcePosition,
				targetX,
				targetY,
				targetPosition,
			});

	const isAuthenticated = edgeData?.authenticated === true;
	const hasTextLabel =
		edgeData?.name || edgeData?.protocol || (edgeData?.data && edgeData.data.length > 0);
	// Show the label chip if there's text content, authenticated (lock icon), or flow number
	const hasLabel = Boolean(hasTextLabel || isAuthenticated || edgeData?.flowNumber != null);

	// Custom label position (user-dragged offset from default)
	const offsetX = (edgeData?.labelOffsetX as number) ?? 0;
	const offsetY = (edgeData?.labelOffsetY as number) ?? 0;
	const hasCustomPosition = offsetX !== 0 || offsetY !== 0;

	const [labelSize, setLabelSize] = useState({ width: 0, height: 0 });
	const { x: labelX, y: labelY } = clearLabelPosition(
		defaultLabelX + offsetX,
		defaultLabelY + offsetY,
		labelSize.width,
		labelSize.height,
		obstacles,
		hasCustomPosition ? undefined : midpoint,
	);

	// When a label exists and has been dragged, route edge through the label as a waypoint
	const edgePath =
		hasLabel && hasCustomPosition
			? getWaypointPath(sourceX, sourceY, targetX, targetY, labelX, labelY)
			: defaultPath;

	const customStrokeColor = edgeData?.strokeColor as string | undefined;
	const customStrokeOpacity = (edgeData?.strokeOpacity as number) ?? 1;
	const hasCustomColor = !!customStrokeColor;

	const [isHovered, setIsHovered] = useState(false);
	const [isEditing, setIsEditing] = useState(false);
	const showLabel = hasLabel && !isEditing;
	const { zoom } = useViewport();

	// --- Draggable label via native pointer events ---
	// React synthetic stopPropagation doesn't prevent ReactFlow's native
	// pointer event listeners from firing. Using a native listener on the
	// DOM element stops propagation before it reaches ReactFlow's container,
	// preventing pane-click deselection and pan/drag interference.
	const labelRef = useRef<HTMLButtonElement>(null);
	useLayoutEffect(() => {
		if (!showLabel) return;
		const label = labelRef.current;
		if (!label) return;
		const measure = () =>
			setLabelSize((size) =>
				size.width === label.offsetWidth && size.height === label.offsetHeight
					? size
					: { width: label.offsetWidth, height: label.offsetHeight },
			);
		measure();
		let frame = 0;
		const observer = new ResizeObserver(() => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(measure);
		});
		observer.observe(label);
		return () => {
			observer.disconnect();
			cancelAnimationFrame(frame);
		};
	}, [showLabel]);
	const isDragging = useRef(false);
	const didDrag = useRef(false);
	const dragStartPos = useRef({ x: 0, y: 0 });
	const dragStartOffset = useRef({ x: 0, y: 0 });
	const wasSelectedBefore = useRef(false);

	// Keep reactive values in a ref so the native listener always reads fresh values
	const stateRef = useRef({
		offsetX,
		offsetY,
		labelX,
		labelY,
		defaultLabelX,
		defaultLabelY,
		zoom,
		selected: !!selected,
	});
	stateRef.current = {
		offsetX,
		offsetY,
		labelX,
		labelY,
		defaultLabelX,
		defaultLabelY,
		zoom,
		selected: !!selected,
	};

	useEffect(() => {
		if (!showLabel) return;
		const el = labelRef.current;
		if (!el) return;

		// Track active document listeners for cleanup on unmount
		let activeMoveListener: ((ev: PointerEvent) => void) | null = null;
		let activeUpListener: (() => void) | null = null;

		const handlePointerDown = (e: PointerEvent) => {
			if (e.button !== 0) return;
			// Native stopPropagation — prevents ReactFlow from seeing this event
			e.stopPropagation();
			e.preventDefault();

			const start = stateRef.current;
			const { offsetX: ox, offsetY: oy, zoom: z, selected: sel } = start;
			wasSelectedBefore.current = sel;

			// Capture pre-drag model with current label offset baked in (for undo)
			let preDragModel: ThreatModel | null = null;
			const currentModel = useModelStore.getState().model;
			if (currentModel) {
				preDragModel = {
					...currentModel,
					data_flows: currentModel.data_flows.map((f) =>
						f.id === id ? { ...f, label_offset: { x: ox, y: oy } } : f,
					),
				};
			}

			// Always select the edge when clicking its label
			useModelStore.getState().setSelectedEdge(id);
			useUiStore.getState().setRightPanelTab("properties");

			isDragging.current = true;
			didDrag.current = false;
			dragStartPos.current = { x: e.clientX, y: e.clientY };
			dragStartOffset.current = {
				x: start.labelX - start.defaultLabelX,
				y: start.labelY - start.defaultLabelY,
			};

			const currentZoom = z;

			const onPointerMove = (ev: PointerEvent) => {
				if (!isDragging.current) return;
				const dx = (ev.clientX - dragStartPos.current.x) / currentZoom;
				const dy = (ev.clientY - dragStartPos.current.y) / currentZoom;
				if (!didDrag.current && Math.abs(dx) + Math.abs(dy) < 3) return;
				didDrag.current = true;
				setEdges((edges) =>
					edges.map((edge) =>
						edge.id === id
							? {
									...edge,
									data: {
										...edge.data,
										labelOffsetX: dragStartOffset.current.x + dx,
										labelOffsetY: dragStartOffset.current.y + dy,
									},
								}
							: edge,
					),
				);
			};

			const onPointerUp = () => {
				isDragging.current = false;
				document.removeEventListener("pointermove", onPointerMove);
				document.removeEventListener("pointerup", onPointerUp);
				if (didDrag.current) {
					// Push pre-drag snapshot to history for undo
					if (preDragModel) {
						useHistoryStore.getState().pushSnapshot(preDragModel);
					}
					// Write new label offset into model
					const model = useModelStore.getState().model;
					if (model) {
						const edges = useCanvasStore.getState().edges;
						const edge = edges.find((e) => e.id === id);
						const edgeData = edge?.data as DfdEdgeData | undefined;
						const newOffsetX = edgeData?.labelOffsetX ?? 0;
						const newOffsetY = edgeData?.labelOffsetY ?? 0;
						const updatedFlows = model.data_flows.map((f) =>
							f.id === id ? { ...f, label_offset: { x: newOffsetX, y: newOffsetY } } : f,
						);
						useModelStore.setState({
							model: { ...model, data_flows: updatedFlows },
							isDirty: true,
						});
					}
					useModelStore.getState().setSelectedEdge(id);
				} else if (wasSelectedBefore.current) {
					// Pure click on already-selected edge → open editor
					setIsEditing(true);
				}
			};

			document.addEventListener("pointermove", onPointerMove);
			document.addEventListener("pointerup", onPointerUp);
			activeMoveListener = onPointerMove;
			activeUpListener = onPointerUp;
		};

		el.addEventListener("pointerdown", handlePointerDown);
		return () => {
			el.removeEventListener("pointerdown", handlePointerDown);
			// Clean up document listeners if component unmounts mid-drag
			if (activeMoveListener) document.removeEventListener("pointermove", activeMoveListener);
			if (activeUpListener) document.removeEventListener("pointerup", activeUpListener);
		};
	}, [id, setEdges, showLabel]);

	return (
		<>
			{/* Invisible wider path for easier click/hover targeting */}
			<path
				d={edgePath}
				fill="none"
				strokeWidth={16}
				className="stroke-transparent"
				onMouseEnter={() => setIsHovered(true)}
				onMouseLeave={() => setIsHovered(false)}
				style={{ pointerEvents: "stroke" }}
			/>
			<BaseEdge
				id={id}
				path={edgePath}
				markerEnd={markerEnd}
				data-testid={`edge-${id}`}
				className={cn(
					"!stroke-[1.25] transition-colors",
					hasCustomColor
						? selected
							? "!stroke-editor-accent"
							: ""
						: selected
							? "!stroke-editor-accent"
							: isHovered
								? "!stroke-muted-foreground/80"
								: "!stroke-muted-foreground/50",
				)}
				style={
					hasCustomColor && !selected
						? {
								stroke: customStrokeColor,
								strokeOpacity: isHovered ? 1 : customStrokeOpacity,
							}
						: undefined
				}
			/>
			{/* Animated flow direction dashes on hover/selection (only for non-authenticated edges) */}
			{(isHovered || selected) && !isAuthenticated && (
				<path
					d={edgePath}
					fill="none"
					strokeWidth={2}
					className={cn("motion-reduce:hidden", !hasCustomColor && "stroke-editor-accent/40")}
					strokeDasharray="6 4"
					style={
						hasCustomColor
							? { pointerEvents: "none", stroke: customStrokeColor, strokeOpacity: 0.4 }
							: { pointerEvents: "none" }
					}
				>
					<animate
						attributeName="stroke-dashoffset"
						from="0"
						to="-20"
						dur="1s"
						repeatCount="indefinite"
					/>
				</path>
			)}
			<EdgeLabelRenderer>
				{showLabel && (
					<button
						ref={labelRef}
						data-testid={`flow-label-${id}`}
						title={[edgeData?.name, edgeData?.protocol, edgeData?.data?.join(", ")]
							.filter(Boolean)
							.join(" · ")}
						type="button"
						className={cn(
							"pointer-events-auto nodrag nopan absolute left-0 top-0 z-10 flex w-max max-w-48 items-center gap-1.5 rounded-editor-control border px-2 py-1 text-left transition-colors",
							selected
								? "border-editor-accent bg-editor-selection text-foreground cursor-grab active:cursor-grabbing"
								: "border-editor-line bg-editor-surface text-muted-foreground hover:border-muted-foreground cursor-pointer",
						)}
						style={{
							transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
						}}
					>
						{edgeData?.flowNumber != null && (
							<span className="shrink-0 text-editor-caption tabular-nums">
								{edgeData.flowNumber}
							</span>
						)}
						{isAuthenticated && <Lock className="size-3 shrink-0" aria-label="Authenticated" />}
						<span className="min-w-0 truncate text-editor-footnote text-foreground">
							{edgeData?.name || edgeData?.protocol || edgeData?.data?.join(", ")}
						</span>
					</button>
				)}
				{isEditing && (
					<EdgeLabelEditor
						edgeId={id}
						name={edgeData?.name ?? ""}
						protocol={edgeData?.protocol ?? ""}
						dataItems={edgeData?.data ?? []}
						labelX={labelX}
						labelY={labelY}
						onClose={() => setIsEditing(false)}
					/>
				)}
				{!hasLabel && !isEditing && (isHovered || selected) && (
					<button
						type="button"
						className="pointer-events-auto nodrag nopan absolute z-10 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:bg-accent"
						style={{
							transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
						}}
						onClick={() => setIsEditing(true)}
					>
						<Plus className="h-3 w-3" />
					</button>
				)}
			</EdgeLabelRenderer>
		</>
	);
}

function EdgeLabelEditor({
	edgeId,
	name,
	protocol,
	dataItems,
	labelX,
	labelY,
	onClose,
}: {
	edgeId: string;
	name: string;
	protocol: string;
	dataItems: string[];
	labelX: number;
	labelY: number;
	onClose: () => void;
}) {
	const nameRef = useRef<HTMLInputElement>(null);
	const protocolRef = useRef<HTMLInputElement>(null);
	const dataRef = useRef<HTMLInputElement>(null);
	const { setEdges } = useReactFlow();

	const commit = useCallback(() => {
		const newName = nameRef.current?.value.trim() ?? "";
		const newProtocol = protocolRef.current?.value.trim() ?? "";
		const newData = (dataRef.current?.value ?? "")
			.split(",")
			.map((s) => s.trim())
			.filter((s) => s.length > 0);

		// Update model store
		const model = useModelStore.getState().model;
		if (model) {
			const updatedFlows = model.data_flows.map((f) =>
				f.id === edgeId ? { ...f, name: newName, protocol: newProtocol, data: newData } : f,
			);
			useModelStore
				.getState()
				.setModel({ ...model, data_flows: updatedFlows }, useModelStore.getState().filePath);
			useModelStore.getState().markDirty();
		}

		// Update canvas edge data
		setEdges((edges) =>
			edges.map((e) =>
				e.id === edgeId
					? {
							...e,
							data: {
								...e.data,
								name: newName,
								protocol: newProtocol,
								data: newData,
							},
						}
					: e,
			),
		);

		onClose();
	}, [edgeId, onClose, setEdges]);

	const containerRef = useRef<HTMLDivElement>(null);

	/** Commit when focus leaves the editor entirely (but not when tabbing between inputs) */
	const handleContainerBlur = useCallback(
		(e: React.FocusEvent) => {
			if (!containerRef.current?.contains(e.relatedTarget as Node)) {
				commit();
			}
		},
		[commit],
	);

	return (
		<div
			ref={containerRef}
			className="pointer-events-all nodrag nopan absolute flex flex-col gap-1 rounded-editor-panel border border-editor-separator bg-editor-raised p-2 shadow-editor-popover"
			style={{
				transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
			}}
			onBlur={handleContainerBlur}
		>
			<input
				ref={nameRef}
				defaultValue={name}
				placeholder="Flow name (e.g. Login Request)"
				autoFocus
				className="w-44 rounded border border-border bg-background px-1.5 py-0.5 text-[11px] font-medium text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none"
				onKeyDown={(e) => {
					e.stopPropagation();
					if (e.key === "Enter") commit();
					if (e.key === "Escape") onClose();
				}}
			/>
			<input
				ref={protocolRef}
				defaultValue={protocol}
				placeholder="Protocol (e.g. HTTPS)"
				className="w-44 rounded border border-border bg-background px-1.5 py-0.5 text-editor-caption2 text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none"
				onKeyDown={(e) => {
					e.stopPropagation();
					if (e.key === "Enter") commit();
					if (e.key === "Escape") onClose();
				}}
			/>
			<input
				ref={dataRef}
				defaultValue={dataItems.join(", ")}
				placeholder="Data (comma-separated)"
				className="w-44 rounded border border-border bg-background px-1.5 py-0.5 text-editor-caption2 text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none"
				onKeyDown={(e) => {
					e.stopPropagation();
					if (e.key === "Enter") commit();
					if (e.key === "Escape") onClose();
				}}
			/>
		</div>
	);
}
