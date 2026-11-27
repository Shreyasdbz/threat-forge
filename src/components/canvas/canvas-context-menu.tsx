import { ArrowLeftRight, Copy, Pencil, Shield, Trash2 } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

interface ContextMenuItem {
	label: string;
	icon: React.ComponentType<{ className?: string }>;
	onClick: () => void;
	variant?: "danger";
}

interface CanvasContextMenuProps {
	x: number;
	y: number;
	items: ContextMenuItem[];
	onClose: () => void;
	trigger?: Element | null;
}

export function CanvasContextMenu({ x, y, items, onClose, trigger }: CanvasContextMenuProps) {
	const menuRef = useRef<HTMLDivElement>(null);
	const returnFocus = useRef<Element | null>(null);

	useLayoutEffect(() => {
		const menu = menuRef.current;
		if (!menu) return;
		const { width, height } = menu.getBoundingClientRect();
		menu.style.left = `${Math.max(0, Math.min(x, window.innerWidth - width))}px`;
		menu.style.top = `${Math.max(0, Math.min(y, window.innerHeight - height))}px`;
		returnFocus.current = trigger ?? document.activeElement;
		menu.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus({ preventScroll: true });
	}, [trigger, x, y]);

	const close = useCallback(() => {
		const element = returnFocus.current;
		if (element instanceof HTMLElement || element instanceof SVGElement) {
			element.focus({ preventScroll: true });
		}
		onClose();
	}, [onClose]);

	useEffect(() => {
		function handleClickOutside(event: MouseEvent) {
			if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
				close();
			}
		}
		document.addEventListener("mousedown", handleClickOutside);
		return () => {
			document.removeEventListener("mousedown", handleClickOutside);
		};
	}, [close]);

	function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
		if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			close();
		} else if (event.key === "Tab") {
			close();
		} else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
			event.preventDefault();
			event.stopPropagation();
			const choices = Array.from(
				event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
			);
			const index = event.target instanceof HTMLButtonElement ? choices.indexOf(event.target) : -1;
			const next =
				event.key === "Home"
					? 0
					: event.key === "End"
						? choices.length - 1
						: (index + (event.key === "ArrowDown" ? 1 : -1) + choices.length) % choices.length;
			choices[next]?.focus({ preventScroll: true });
		}
	}

	return createPortal(
		<div
			ref={menuRef}
			role="menu"
			aria-label="Context actions"
			onKeyDown={handleKeyDown}
			className="fixed z-50 min-w-40 rounded-editor-panel border border-editor-separator bg-editor-raised py-1 shadow-editor-popover"
			style={{ left: x, top: y }}
		>
			{items.map((item) => (
				<button
					type="button"
					key={item.label}
					role="menuitem"
					data-variant={item.variant}
					tabIndex={-1}
					className={cn(
						"flex w-full items-center gap-2 px-3 py-1.5 text-xs transition-colors focus-visible:bg-editor-hover focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-editor-accent",
						item.variant === "danger"
							? "text-destructive-foreground hover:bg-editor-hover"
							: "text-foreground hover:bg-accent",
					)}
					onClick={() => {
						close();
						item.onClick();
					}}
				>
					<item.icon className="h-3.5 w-3.5" />
					{item.label}
				</button>
			))}
		</div>,
		document.body,
	);
}

/** Build menu items for a node context menu */
export function buildNodeMenuItems({
	onEditProperties,
	onDelete,
	onDuplicate,
	onViewThreats,
	isTextAnnotation,
}: {
	onEditProperties: () => void;
	onDelete: () => void;
	onDuplicate: () => void;
	onViewThreats: () => void;
	isTextAnnotation?: boolean;
}): ContextMenuItem[] {
	const items: ContextMenuItem[] = [
		{ label: "Edit Properties", icon: Pencil, onClick: onEditProperties },
	];
	if (!isTextAnnotation) {
		items.push({ label: "View Threats", icon: Shield, onClick: onViewThreats });
	}
	items.push({ label: "Duplicate", icon: Copy, onClick: onDuplicate });
	items.push({ label: "Delete", icon: Trash2, onClick: onDelete, variant: "danger" });
	return items;
}

/** Build menu items for an edge context menu */
export function buildEdgeMenuItems({
	onEditProperties,
	onDelete,
	onReverseDirection,
}: {
	onEditProperties: () => void;
	onDelete: () => void;
	onReverseDirection: () => void;
}): ContextMenuItem[] {
	return [
		{ label: "Edit Properties", icon: Pencil, onClick: onEditProperties },
		{
			label: "Reverse Direction",
			icon: ArrowLeftRight,
			onClick: onReverseDirection,
		},
		{ label: "Delete", icon: Trash2, onClick: onDelete, variant: "danger" },
	];
}

export type { ContextMenuItem };
