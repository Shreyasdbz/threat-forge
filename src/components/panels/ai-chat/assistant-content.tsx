import { Check, Loader2, Play, X } from "lucide-react";
import { useCallback, useState } from "react";
import { extractDisplayContent, stripBlocksForStreaming } from "@/lib/ai/display-content";
import { extractLegacyActions, extractLegacyThreats } from "@/lib/ai/legacy/fenced-actions";
import {
	describeActionReview,
	executeActions,
	executeSingleAction,
	isDestructiveAction,
	reviewDeletion,
} from "@/lib/ai-action-executor";
import type { AiAction } from "@/lib/ai-actions";
import { suggestionToThreat } from "@/lib/ai-utils";
import { cn } from "@/lib/utils";
import { useCanvasStore } from "@/stores/canvas-store";
import { useModelStore } from "@/stores/model-store";
import type { Threat } from "@/types/threat-model";
import { MarkdownContent } from "../markdown-content";

export function AssistantContent({
	content,
	isStreaming,
	isLast,
	fencedEnabled,
}: {
	content: string;
	isStreaming: boolean;
	isLast: boolean;
	/** Whether fenced parsing runs; a tool-enabled turn passes `false`. */
	fencedEnabled: boolean;
}) {
	const addThreat = useModelStore((s) => s.addThreat);
	const [acceptedIds, setAcceptedIds] = useState<Set<number>>(new Set());

	// `content` is the assistant turn's accumulated text; fenced parsing is the
	// legacy boundary's job and only runs there (issue #64 removes it). A
	// tool-enabled turn disables it so an injected fence cannot bypass the ledger.
	const parseFenced = isLast && !isStreaming && fencedEnabled;
	const threats = parseFenced ? extractLegacyThreats(content) : [];
	const actions = parseFenced ? extractLegacyActions(content) : [];

	const handleAccept = useCallback(
		(index: number, threat: Threat) => {
			addThreat(threat);
			setAcceptedIds((prev) => new Set([...prev, index]));
		},
		[addThreat],
	);

	const displayContent = isStreaming
		? stripBlocksForStreaming(content)
		: extractDisplayContent(content);

	return (
		<div className="flex flex-col gap-2">
			{displayContent && <MarkdownContent content={displayContent} />}
			{isStreaming && (
				<Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none text-muted-foreground" />
			)}

			{actions.length > 0 && <ActionPreview actions={actions} />}

			{threats.length > 0 && (
				<div className="flex flex-col gap-1.5 border-t border-border/30 pt-1.5">
					<span className="text-editor-caption2 text-muted-foreground">
						Suggested threats ({threats.length}):
					</span>
					{threats.map((threat, i) => (
						<ThreatSuggestionCard
							// biome-ignore lint/suspicious/noArrayIndexKey: threat index is stable after streaming
							key={i}
							title={threat.title}
							category={threat.category}
							severity={threat.severity}
							accepted={acceptedIds.has(i)}
							onAccept={() => handleAccept(i, suggestionToThreat(threat))}
						/>
					))}
				</div>
			)}
		</div>
	);
}

type ActionStatus = "pending" | "applied" | "failed";

/** Preview and apply AI-suggested model actions. */
function ActionPreview({ actions }: { actions: AiAction[] }) {
	const [actionStatus, setActionStatus] = useState<Map<number, ActionStatus>>(new Map());
	const model = useModelStore((s) => s.model);

	let appliedCount = 0;
	let failedCount = 0;
	for (const s of actionStatus.values()) {
		if (s === "applied") appliedCount++;
		else if (s === "failed") failedCount++;
	}
	const remainingCount = actions.length - appliedCount - failedCount;
	const allDone = appliedCount + failedCount === actions.length;
	const hasPendingDeletion = actions.some(
		(action, i) => !actionStatus.has(i) && isDestructiveAction(action.action),
	);

	const handleApplyOne = useCallback(
		(index: number) => {
			if (useModelStore.getState().model !== model) return;
			const success = executeSingleAction(actions[index]);
			setActionStatus((prev) => {
				const next = new Map(prev);
				next.set(index, success ? "applied" : "failed");
				return next;
			});
			useCanvasStore.getState().syncFromModel();
		},
		[actions, model],
	);

	const handleApplyRemaining = useCallback(() => {
		if (hasPendingDeletion || useModelStore.getState().model !== model) return;
		const remaining = actions
			.map((action, i) => ({ action, i }))
			.filter(({ i }) => !actionStatus.has(i));
		const res = executeActions(remaining.map((r) => r.action));
		setActionStatus((prev) => {
			const next = new Map(prev);
			// Mark all as applied only if zero failures; otherwise mark all as failed
			// (batch doesn't track per-action results, so be conservative)
			const status: ActionStatus = res.failed === 0 ? "applied" : "failed";
			for (const { i } of remaining) {
				next.set(i, status);
			}
			return next;
		});
		useCanvasStore.getState().syncFromModel();
	}, [actions, actionStatus, hasPendingDeletion, model]);

	return (
		<div className="flex flex-col gap-1.5 border-t border-border/30 pt-1.5">
			<div className="flex items-center justify-between">
				<span className="text-editor-caption2 text-muted-foreground">
					Suggested changes ({actions.length}):
				</span>
				{!allDone && !hasPendingDeletion && (
					<button
						type="button"
						onClick={handleApplyRemaining}
						className="flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-editor-caption2 text-primary hover:bg-primary/20 transition-colors"
					>
						<Play className="h-2.5 w-2.5" />
						{appliedCount === 0 ? "Apply All" : `Apply Remaining (${remainingCount})`}
					</button>
				)}
				{allDone && (
					<span className="text-editor-caption2 text-muted-foreground">
						{appliedCount} applied{failedCount > 0 ? `, ${failedCount} failed` : ""}
					</span>
				)}
			</div>
			{actions.map((action, i) => (
				<ActionRow
					// biome-ignore lint/suspicious/noArrayIndexKey: action index is stable after streaming
					key={i}
					summary={describeActionReview(action, reviewDeletion(action, model))}
					status={actionStatus.get(i) ?? "pending"}
					onApply={() => handleApplyOne(i)}
				/>
			))}
		</div>
	);
}

/** Single action row with per-action apply button. */
function ActionRow({
	summary,
	status,
	onApply,
}: {
	summary: string;
	status: ActionStatus;
	onApply: () => void;
}) {
	return (
		<div
			className={cn(
				"flex items-center gap-1.5 rounded border p-1.5 text-editor-caption2",
				status === "applied" && "border-border/50 bg-background/50 opacity-60",
				status === "failed" && "border-destructive/30 bg-background/50",
				status === "pending" && "border-border/50 bg-background/50",
			)}
		>
			<span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{summary}</span>
			<button
				type="button"
				onClick={onApply}
				disabled={status !== "pending"}
				className={cn(
					"shrink-0 rounded p-1 transition-colors",
					status === "pending" && "text-primary hover:bg-primary/10",
					status === "applied" && "cursor-default text-green-500",
					status === "failed" && "cursor-default text-destructive",
				)}
				title={
					status === "applied" ? "Applied" : status === "failed" ? "Failed" : "Apply this change"
				}
			>
				{status === "applied" && <Check className="h-3.5 w-3.5" />}
				{status === "failed" && <X className="h-3.5 w-3.5" />}
				{status === "pending" && <Play className="h-3.5 w-3.5" />}
			</button>
		</div>
	);
}

function ThreatSuggestionCard({
	title,
	category,
	severity,
	accepted,
	onAccept,
}: {
	title: string;
	category: string;
	severity: string;
	accepted: boolean;
	onAccept: () => void;
}) {
	return (
		<div className="flex items-start gap-1.5 rounded border border-border/50 bg-background/50 p-1.5">
			<div className="flex-1">
				<p className="text-editor-caption2">{title}</p>
				<div className="mt-0.5 flex items-center gap-1">
					<span className="rounded bg-secondary/50 px-1 py-0.5 text-[9px]">{category}</span>
					<span className="rounded bg-secondary/50 px-1 py-0.5 text-[9px] capitalize">
						{severity}
					</span>
				</div>
			</div>
			<button
				type="button"
				onClick={onAccept}
				disabled={accepted}
				className={cn(
					"shrink-0 rounded p-1 transition-colors",
					accepted ? "cursor-default text-green-500" : "text-primary hover:bg-primary/10",
				)}
				title={accepted ? "Accepted" : "Accept threat"}
			>
				<Check className="h-3.5 w-3.5" />
			</button>
		</div>
	);
}
