import { type KeyboardEvent, useState } from "react";
import { cn } from "@/lib/utils";
import { useModelStore } from "@/stores/model-store";
import { type RightPanelTab, useUiStore } from "@/stores/ui-store";
import { AiChatTab } from "./ai-chat-tab";
import { ArchitectureTab } from "./architecture-tab";
import { PropertiesTab } from "./properties-tab";
import { ThreatsTab } from "./threats-tab";

const tabs = [
	{ id: "properties", label: "Properties", Panel: PropertiesTab },
	{ id: "architecture", label: "Architecture", Panel: ArchitectureTab },
	{ id: "threats", label: "Threats", Panel: ThreatsTab },
	{ id: "ai", label: "AI", Panel: AiChatTab },
] as const;

export function RightPanel() {
	const selected = useUiStore((s) => s.rightPanelTab);
	const setTab = useUiStore((s) => s.setRightPanelTab);
	const threatCount = useModelStore((s) => s.model?.threats.length ?? 0);
	const [focused, setFocused] = useState<RightPanelTab | null>(null);

	function moveFocus(event: KeyboardEvent<HTMLButtonElement>, index: number) {
		let next: number;
		switch (event.key) {
			case "ArrowLeft":
				next = (index + tabs.length - 1) % tabs.length;
				break;
			case "ArrowRight":
				next = (index + 1) % tabs.length;
				break;
			case "Home":
				next = 0;
				break;
			case "End":
				next = tabs.length - 1;
				break;
			default:
				return;
		}
		event.preventDefault();
		event.stopPropagation();
		event.currentTarget.parentElement?.querySelectorAll("button")[next]?.focus();
	}

	return (
		<div data-testid="right-panel" className="@container/inspector flex h-full min-h-0 flex-col">
			<div
				role="tablist"
				aria-label="Inspector"
				onBlur={(event) => {
					if (!event.currentTarget.contains(event.relatedTarget)) setFocused(null);
				}}
				className="mx-2 grid shrink-0 grid-cols-2 border-b border-editor-separator pt-1 @min-[19rem]/inspector:grid-cols-4"
			>
				{tabs.map(({ id, label }, index) => (
					<button
						key={id}
						type="button"
						role="tab"
						id={`inspector-tab-${id}`}
						data-testid={`tab-${id}`}
						aria-selected={selected === id}
						aria-description={
							id === "threats" && threatCount ? `${threatCount} identified` : undefined
						}
						aria-controls={`inspector-panel-${id}`}
						tabIndex={(focused ?? selected) === id ? 0 : -1}
						onFocus={() => setFocused(id)}
						onClick={() => setTab(id)}
						onKeyDown={(event) => moveFocus(event, index)}
						className={cn(
							"min-h-8 min-w-0 break-words rounded-t-editor-control border-b-2 px-0.5 py-2 transition-colors duration-120 ease-editor",
							selected === id
								? "border-editor-accent text-foreground"
								: "border-transparent text-editor-secondary-label hover:text-foreground",
						)}
					>
						<span className="text-editor-caption2">{label}</span>
					</button>
				))}
			</div>
			{tabs.map(({ id, Panel }) => (
				<div
					key={id}
					id={`inspector-panel-${id}`}
					role="tabpanel"
					aria-labelledby={`inspector-tab-${id}`}
					hidden={id !== selected}
					// biome-ignore lint/a11y/noNoninteractiveTabindex: arrow-key tabs lead into scrollable panel content
					tabIndex={0}
					className="min-h-0 flex-1 overflow-y-auto p-4 focus-visible:-outline-offset-2"
				>
					{id === selected && <Panel />}
				</div>
			))}
		</div>
	);
}
