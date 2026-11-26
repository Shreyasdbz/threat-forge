import { useModelStore } from "@/stores/model-store";
import { useUiStore } from "@/stores/ui-store";

export function ThreatLink({
	threatId,
	title,
	severity,
}: {
	threatId: string;
	title: string;
	severity: string;
}) {
	const setSelectedThreat = useModelStore((s) => s.setSelectedThreat);
	const setRightPanelTab = useUiStore((s) => s.setRightPanelTab);

	return (
		<button
			type="button"
			onClick={() => {
				setSelectedThreat(threatId);
				setRightPanelTab("threats");
			}}
			className="flex items-center justify-between rounded px-1.5 py-1 text-editor-caption hover:bg-accent transition-colors text-left"
		>
			<span className="truncate">{title}</span>
			<SeverityDot severity={severity} />
		</button>
	);
}

function SeverityDot({ severity }: { severity: string }) {
	const colorMap: Record<string, string> = {
		critical: "bg-red-400",
		high: "bg-orange-400",
		medium: "bg-yellow-400",
		low: "bg-blue-400",
		info: "bg-gray-400",
	};

	return (
		<span className={`h-2 w-2 shrink-0 rounded-full ${colorMap[severity] ?? "bg-gray-400"}`} />
	);
}
