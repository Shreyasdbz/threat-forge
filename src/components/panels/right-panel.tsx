import { Layers3, type LucideIcon, MessageSquare, Shield, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { useModelStore } from "@/stores/model-store";
import { useUiStore } from "@/stores/ui-store";
import { AiChatTab } from "./ai-chat-tab";
import { ArchitectureTab } from "./architecture-tab";
import { PropertiesTab } from "./properties-tab";
import { ThreatsTab } from "./threats-tab";

export function RightPanel() {
	const tab = useUiStore((s) => s.rightPanelTab);
	const setTab = useUiStore((s) => s.setRightPanelTab);
	const threatCount = useModelStore((s) => s.model?.threats.length ?? 0);

	return (
		<div data-testid="right-panel" className="flex h-full flex-col">
			{/* Tab bar */}
			<div className="mx-2 mt-3 grid shrink-0 grid-cols-4 gap-px rounded-editor-panel bg-editor-fill p-1">
				<TabButton
					testId="tab-properties"
					icon={SlidersHorizontal}
					active={tab === "properties"}
					onClick={() => setTab("properties")}
				>
					Properties
				</TabButton>
				<TabButton
					testId="tab-architecture"
					icon={Layers3}
					active={tab === "architecture"}
					onClick={() => setTab("architecture")}
				>
					Architecture
				</TabButton>
				<TabButton
					testId="tab-threats"
					icon={Shield}
					count={threatCount}
					active={tab === "threats"}
					onClick={() => setTab("threats")}
				>
					Threats
				</TabButton>
				<TabButton
					testId="tab-ai"
					icon={MessageSquare}
					active={tab === "ai"}
					onClick={() => setTab("ai")}
				>
					AI
				</TabButton>
			</div>

			{/* Tab content */}
			<div className="flex-1 overflow-y-auto p-4">
				{tab === "properties" && <PropertiesTab />}
				{tab === "architecture" && <ArchitectureTab />}
				{tab === "threats" && <ThreatsTab />}
				{tab === "ai" && <AiChatTab />}
			</div>
		</div>
	);
}

function TabButton({
	testId,
	icon: Icon,
	count,
	active,
	onClick,
	children,
}: {
	testId?: string;
	icon: LucideIcon;
	count?: number;
	active: boolean;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			data-testid={testId}
			aria-pressed={active}
			onClick={onClick}
			className={cn(
				"flex min-w-0 flex-col items-center justify-center gap-1 rounded-editor-control py-1.5 transition-colors duration-120 ease-editor",
				active
					? "bg-editor-selection text-foreground"
					: "text-muted-foreground hover:bg-editor-hover hover:text-foreground",
			)}
		>
			<span className="relative">
				<Icon aria-hidden="true" className="size-4" />
				{!!count && (
					<span className="absolute left-full top-0 ml-1 text-editor-caption2 tabular-nums text-editor-tertiary-label">
						{count > 99 ? "99+" : count}
					</span>
				)}
			</span>
			<span className="max-w-full truncate text-editor-caption2">{children}</span>
		</button>
	);
}
