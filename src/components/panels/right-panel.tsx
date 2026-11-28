import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useModelStore } from "@/stores/model-store";
import { useUiStore } from "@/stores/ui-store";
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
	const [focusInTabs, setFocusInTabs] = useState(false);
	return (
		<Tabs
			data-testid="right-panel"
			value={selected}
			onValueChange={(value) => {
				const tab = tabs.find(({ id }) => id === value);
				if (tab) setTab(tab.id);
			}}
			className="flex h-full min-h-0 flex-col gap-0"
		>
			<TooltipProvider delay={300}>
				<TabsList
					variant="line"
					aria-label="Inspector"
					onFocus={() => setFocusInTabs(true)}
					onBlur={(event) => {
						if (!event.currentTarget.contains(event.relatedTarget)) setFocusInTabs(false);
					}}
					className="grid w-full shrink-0 grid-cols-4 border-b border-editor-separator p-0 group-data-horizontal/tabs:h-editor-row"
				>
					{tabs.map(({ id, label }) => {
						const count = id === "threats" ? threatCount : 0;
						return (
							<Tooltip key={id}>
								<TooltipTrigger
									render={
										<TabsTrigger
											value={id}
											{...(!focusInTabs && { tabIndex: id === selected ? 0 : -1 })}
											data-testid={`tab-${id}`}
											aria-label={label}
											aria-description={count ? `${count} identified` : undefined}
											className="h-full min-w-0 px-0 text-editor-footnote group-data-horizontal/tabs:after:bottom-0 data-active:text-editor-accent"
										/>
									}
								>
									{label}
								</TooltipTrigger>
								<TooltipContent side="bottom" className="rounded-none font-editor">
									{label}
								</TooltipContent>
							</Tooltip>
						);
					})}
				</TabsList>
			</TooltipProvider>
			{tabs.map(({ id, Panel }) => (
				<TabsContent
					key={id}
					value={id}
					className="min-h-0 flex-1 overflow-y-auto p-3 text-editor-body focus-visible:-outline-offset-2"
				>
					{id === selected && <Panel />}
				</TabsContent>
			))}
		</Tabs>
	);
}
