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
	const model = useModelStore((s) => s.model);

	return (
		<div data-testid="right-panel" className="flex h-full flex-col">
			{/* Tab bar */}
			<div className="flex h-10 shrink-0 items-stretch overflow-x-auto border-b border-editor-line px-1">
				<TabButton
					testId="tab-properties"
					active={tab === "properties"}
					onClick={() => setTab("properties")}
				>
					Properties
				</TabButton>
				<TabButton
					testId="tab-architecture"
					active={tab === "architecture"}
					onClick={() => setTab("architecture")}
				>
					Architecture
				</TabButton>
				<TabButton
					testId="tab-threats"
					active={tab === "threats"}
					onClick={() => setTab("threats")}
				>
					Threats
					{model && model.threats.length > 0 && (
						<span className="ml-1 text-editor-small font-normal text-muted-foreground">
							{model.threats.length}
						</span>
					)}
				</TabButton>
				<TabButton testId="tab-ai" active={tab === "ai"} onClick={() => setTab("ai")}>
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
	active,
	onClick,
	children,
}: {
	testId?: string;
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
				"flex-auto whitespace-nowrap border-b-2 border-transparent px-1 text-editor-small font-semibold transition-colors",
				active
					? "border-editor-accent text-foreground"
					: "text-muted-foreground hover:text-foreground",
			)}
		>
			{children}
		</button>
	);
}
