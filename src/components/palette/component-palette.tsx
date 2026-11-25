import { type ReactFlowInstance, useReactFlow } from "@xyflow/react";
import { Search, ShieldAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { IconRenderer } from "@/components/icons/icon-renderer";
import { DEFAULT_NODE_HEIGHT, DEFAULT_NODE_WIDTH, nodeToRect } from "@/lib/canvas-utils";
import {
	listCategories,
	listComponents,
	resolveElementIcon,
	searchComponents,
} from "@/lib/registry/registry";
import type { ComponentCategory, ComponentEntry } from "@/lib/registry/types";
import { useCanvasInstanceStore } from "@/stores/canvas-instance-store";
import { useCanvasStore } from "@/stores/canvas-store";

/** Sentinel category slug for "show every library component". */
const ALL_CATEGORIES = "all";

/** Library components exclude the generic default type (it lives in the Generic section). */
function isLibraryComponent(component: ComponentEntry): boolean {
	return component.category !== "generic";
}

/** Generic palette items (always visible at top) */
const GENERIC_ITEMS = [
	{
		type: "generic" as const,
		label: "Component",
		description: "Generic component",
	},
	{
		type: "trust_boundary" as const,
		label: "Boundary",
		description: "Trust zone boundary",
	},
	{
		type: "text" as const,
		label: "Text",
		description: "Text annotation",
	},
];

export function ComponentPalette() {
	const [searchQuery, setSearchQuery] = useState("");
	const [activeCategory, setActiveCategory] = useState<ComponentCategory | typeof ALL_CATEGORIES>(
		ALL_CATEGORIES,
	);

	const filteredComponents = useMemo(() => {
		if (searchQuery.trim()) {
			return searchComponents(searchQuery).filter(isLibraryComponent);
		}
		if (activeCategory !== ALL_CATEGORIES) {
			return listComponents({ category: activeCategory }).filter(isLibraryComponent);
		}
		return listComponents().filter(isLibraryComponent);
	}, [searchQuery, activeCategory]);

	const categories = listCategories();

	return (
		<div data-testid="component-palette" className="flex h-full flex-col">
			{/* Generic section */}
			<div className="px-4 pt-4 pb-2">
				<h2 className="text-editor-footnote text-muted-foreground">Generic</h2>
			</div>
			<div className="px-3 pb-2">
				<div className="flex flex-col gap-1">
					{GENERIC_ITEMS.map((item) => (
						<GenericPaletteItem
							key={item.type}
							type={item.type}
							label={item.label}
							description={item.description}
						/>
					))}
				</div>
			</div>

			{/* Library section */}
			<div className="px-4 pt-4 pb-2">
				<h2 className="text-editor-footnote text-muted-foreground">Library</h2>
			</div>

			{/* Search */}
			<div className="px-4 pb-2">
				<div className="relative">
					<Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
					<input
						data-testid="library-search"
						type="text"
						placeholder="Search components..."
						value={searchQuery}
						onChange={(e) => {
							setSearchQuery(e.target.value);
							if (e.target.value) setActiveCategory(ALL_CATEGORIES);
						}}
						className="w-full rounded-editor-control border border-editor-outline bg-editor-surface py-2 pl-9 pr-3 text-editor-body placeholder:text-editor-tertiary-label focus:border-editor-accent"
					/>
				</div>
			</div>

			{!searchQuery && (
				<div className="px-4 pb-2">
					<select
						aria-label="Component category"
						value={activeCategory}
						onChange={(event) =>
							setActiveCategory(
								categories.find(({ id }) => id === event.target.value)?.id ?? ALL_CATEGORIES,
							)
						}
						className="min-h-8 w-full rounded-editor-control border border-editor-outline bg-editor-surface px-3 text-editor-body"
					>
						<option value={ALL_CATEGORIES}>All categories</option>
						{categories.map(({ id, label }) => (
							<option key={id} value={id}>
								{label}
							</option>
						))}
					</select>
				</div>
			)}

			{/* Component list */}
			<section
				aria-label="Library components"
				className="flex-1 overflow-y-auto px-3 pb-3"
				// biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be focusable for keyboard access
				tabIndex={0}
				onKeyDown={(event) => {
					if (
						event.target === event.currentTarget &&
						(event.key === "ArrowUp" || event.key === "ArrowDown")
					) {
						event.stopPropagation();
					}
				}}
			>
				<div className="flex flex-col gap-0.5">
					{filteredComponents.map((comp) => (
						<LibraryPaletteItem key={comp.id} component={comp} />
					))}
					{filteredComponents.length === 0 && (
						<p className="px-2 py-4 text-center text-editor-caption text-muted-foreground">
							No matching components
						</p>
					)}
				</div>
			</section>
		</div>
	);
}

/** Get the center of the visible canvas area in flow coordinates */
function getCanvasCenter(screenToFlowPosition: ReactFlowInstance["screenToFlowPosition"]) {
	const canvasEl = document.querySelector(".react-flow");
	if (!canvasEl) return { x: 200, y: 200 };
	const rect = canvasEl.getBoundingClientRect();
	return screenToFlowPosition({
		x: rect.left + rect.width / 2,
		y: rect.top + rect.height / 2,
	});
}

function getComponentPosition({
	screenToFlowPosition,
	getInternalNode,
}: Pick<ReactFlowInstance, "screenToFlowPosition" | "getInternalNode">) {
	const { nodes } = useCanvasStore.getState();
	const { x, y: centerY } = getCanvasCenter(screenToFlowPosition);
	const gap = 32;
	const blocked = nodes
		.filter((node) => node.type !== "architectureGroup")
		.flatMap((node) => {
			const rect = nodeToRect({
				...node,
				position: getInternalNode(node.id)?.internals.positionAbsolute ?? node.position,
			});
			const bottom = rect.y + rect.height;
			const right = rect.x + rect.width;
			if (node.data.isBoundary) {
				if (x < rect.x || x > right) return [];
				return [
					{
						start:
							x + DEFAULT_NODE_WIDTH > right
								? rect.y
								: Math.max(rect.y, bottom - DEFAULT_NODE_HEIGHT),
						end: bottom + gap,
					},
				];
			}
			return x < right + gap && x + DEFAULT_NODE_WIDTH + gap > rect.x
				? [{ start: rect.y - DEFAULT_NODE_HEIGHT - gap, end: bottom + gap }]
				: [];
		})
		.sort((a, b) => a.start - b.start);
	let y = centerY;
	for (const { start, end } of blocked) {
		if (y < start) break;
		y = Math.max(y, end);
	}
	return { x, y };
}

/** Create a styled drag ghost image and attach it to the drag event */
function setDragGhost(e: React.DragEvent, label: string) {
	const ghost = document.createElement("div");
	ghost.textContent = label;
	ghost.style.cssText =
		"position:fixed;left:-9999px;padding:6px 12px;border-radius:8px;font-size:12px;font-weight:500;background:hsl(var(--card));border:1px solid hsl(var(--border));box-shadow:0 4px 6px rgba(0,0,0,0.1);color:hsl(var(--foreground));white-space:nowrap;";
	document.body.appendChild(ghost);
	e.dataTransfer.setDragImage(ghost, ghost.offsetWidth / 2, ghost.offsetHeight / 2);
	// Clean up after the drag image is captured
	requestAnimationFrame(() => ghost.remove());
}

/** Generic items: Component (generic) and Boundary. No subtype. */
function GenericPaletteItem({
	label,
	type,
	description,
}: {
	label: string;
	type: string;
	description: string;
}) {
	const flow = useReactFlow();
	const icon = type === "trust_boundary" ? undefined : resolveElementIcon({ type });

	const handleDoubleClick = () => {
		if (type === "trust_boundary") {
			useCanvasStore
				.getState()
				.addTrustBoundary("New Boundary", getCanvasCenter(flow.screenToFlowPosition));
		} else {
			useCanvasStore.getState().addElement(type, getComponentPosition(flow));
		}
	};

	return (
		<div
			data-testid={`palette-item-${type.replace(/_/g, "-")}`}
			className="flex min-h-8 cursor-grab items-center gap-2 rounded-editor-control px-2 py-1 transition-colors duration-120 ease-editor hover:bg-editor-hover"
			draggable
			onDoubleClick={handleDoubleClick}
			onDragStart={(e) => {
				e.dataTransfer.setData("text/plain", type);
				e.dataTransfer.effectAllowed = "copy";
				setDragGhost(e, label);
				// Use setDraggedComponent to clear any stale subtype/icon/name from a prior library drag
				useCanvasInstanceStore.getState().setDraggedComponent({ type });
			}}
			onDragEnd={(e) => {
				const draggedType = useCanvasInstanceStore.getState().draggedType;
				useCanvasInstanceStore.getState().setDraggedComponent(null);
				if (!draggedType) return;

				const target = document.elementFromPoint(e.clientX, e.clientY);
				const canvas = document.querySelector(".react-flow");
				if (!canvas?.contains(target)) return;

				const position = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY });

				if (draggedType === "trust_boundary") {
					useCanvasStore.getState().addTrustBoundary("New Boundary", position);
				} else {
					useCanvasStore.getState().addElement(draggedType, position);
				}
			}}
		>
			<div className="grid size-6 shrink-0 place-items-center">
				{icon ? (
					<IconRenderer icon={icon} className="h-4 w-4 text-muted-foreground" />
				) : (
					<ShieldAlert className="h-4 w-4 text-muted-foreground" />
				)}
			</div>
			<p title={description} className="min-w-0 truncate text-editor-body">
				{label}
			</p>
		</div>
	);
}

/** Library items: specific typed components. */
function LibraryPaletteItem({ component }: { component: ComponentEntry }) {
	const flow = useReactFlow();
	const icon = resolveElementIcon({ type: component.id });

	const handleDoubleClick = () => {
		const position = getComponentPosition(flow);
		useCanvasStore
			.getState()
			.addElement(component.id, position, { icon: component.iconId, name: component.label });
	};

	return (
		<div
			data-testid={`palette-item-${component.id.replace(/_/g, "-")}`}
			className="flex min-h-8 cursor-grab items-center gap-2 rounded-editor-control px-2 py-1 transition-colors duration-120 ease-editor hover:bg-editor-hover"
			draggable
			onDoubleClick={handleDoubleClick}
			onDragStart={(e) => {
				e.dataTransfer.setData("text/plain", component.id);
				e.dataTransfer.effectAllowed = "copy";
				setDragGhost(e, component.label);
				useCanvasInstanceStore.getState().setDraggedComponent({
					type: component.id,
					icon: component.iconId,
					name: component.label,
				});
			}}
			onDragEnd={(e) => {
				const draggedType = useCanvasInstanceStore.getState().draggedType;
				useCanvasInstanceStore.getState().setDraggedComponent(null);
				if (!draggedType) return;

				const target = document.elementFromPoint(e.clientX, e.clientY);
				const canvas = document.querySelector(".react-flow");
				if (!canvas?.contains(target)) return;

				const position = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
				useCanvasStore
					.getState()
					.addElement(draggedType, position, { icon: component.iconId, name: component.label });
			}}
		>
			<div className="grid size-6 shrink-0 place-items-center">
				<IconRenderer icon={icon} className="size-4 text-muted-foreground" />
			</div>
			<p className="min-w-0 truncate text-editor-body">{component.label}</p>
		</div>
	);
}
