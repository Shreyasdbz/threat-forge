import { useModelStore } from "@/stores/model-store";

export function ThreatBadge({ count }: { count: number }) {
	return (
		<div className="absolute right-1 top-1 rounded-full bg-editor-hover px-1.5 text-[10px] leading-4 tabular-nums text-muted-foreground">
			{count}
			<span className="sr-only">{count === 1 ? " threat" : " threats"}</span>
		</div>
	);
}

export function useThreatCount(elementId: string): number {
	return useModelStore((s) => {
		if (!s.model) return 0;
		return s.model.threats.filter((t) => t.element === elementId).length;
	});
}
