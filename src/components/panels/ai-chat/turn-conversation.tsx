import { AlertCircle, Info, Loader2, Undo2 } from "lucide-react";
import { Fragment } from "react";
import type { TurnState } from "@/lib/ai/loop/turn-machine";
import { useAiTurnStore } from "@/stores/ai-turn-store";
import { useHistoryStore } from "@/stores/history-store";
import { ChatViewport } from "../chat-viewport";
import { ToolCallCard } from "../tool-call-card";
import { hasVisibleText, MessageBubble } from "./chat-transcript";
import { ProposalReviewPanel } from "./proposal-review";

const proposalMessages = {
	applied: "Proposal applied.",
	rejected: "Proposal rejected. No changes were made.",
	stale: "The document changed during review. No changes were made. Ask for a new proposal.",
	discarded: "The proposal could not be completed. No changes were made.",
	unchanged: "The proposal made no document changes.",
};

/** The live tool-loop turn: its conversation, approval cards, notice, and one-step undo. */
export function TurnConversation({ turn }: { turn: TurnState }) {
	const turnStartIndex = useAiTurnStore((s) => s.turnStartIndex);
	const getToolCallPresentation = useAiTurnStore((s) => s.getToolCallPresentation);
	const undoTurn = useAiTurnStore((s) => s.undoTurn);
	const undoAvailability = useAiTurnStore((s) => s.undoAvailability);
	// Undo availability lives in the runner's ledger and depends on the history
	// stack, which changes when the user edits or presses Cmd+Z after the turn
	// without touching the turn. Selecting the stack depth re-renders this panel on
	// those edits so the button's disabled state stays accurate; the depth itself
	// is not otherwise needed, only its change.
	const historyStackDepth = useHistoryStore((s) => s.past.length);

	const isStreaming = turn.phase === "requesting" || turn.phase === "streaming";
	const isPreparing = turn.phase === "preparing_review" || turn.phase === "executing";
	const bubbles = turn.messages.filter(hasVisibleText);
	// Reading the stack depth above subscribes this panel so the button's disabled
	// state updates on a post-turn edit; the value itself is only a change signal,
	// and `undoAvailability()` reads the live stack when it recomputes below.
	void historyStackDepth;
	const availability = turn.proposalOutcome === "applied" ? undoAvailability() : "already_undone";

	return (
		<ChatViewport activity={turn} runId={turn.budget.startedAtMs}>
			{turn.messages.map((message, i) => {
				const toolIds = message.content.flatMap((b) => (b.type === "tool_call" ? [b.id] : []));
				const calls =
					i >= turnStartIndex && turn.phase === "settled"
						? turn.calls.filter((c) => toolIds.includes(c.id))
						: [];
				const previousCalls = i < turnStartIndex ? getToolCallPresentation(message) : [];
				const last = message === bubbles[bubbles.length - 1];
				return (
					// biome-ignore lint/suspicious/noArrayIndexKey: transcript messages retain their order during a turn
					<Fragment key={i}>
						{hasVisibleText(message) && (
							<MessageBubble
								message={message}
								isStreaming={isStreaming && last && message.role === "assistant"}
							/>
						)}
						{(calls.length > 0 || previousCalls.length > 0) && (
							<div className="space-y-2">
								{[...calls, ...previousCalls].map((call) => (
									<ToolCallCard key={call.id} call={call} />
								))}
							</div>
						)}
						{i < turnStartIndex && toolIds.length > 0 && previousCalls.length === 0 && (
							<p className="rounded-lg border border-border px-3 py-2 text-editor-caption text-muted-foreground">
								{message.content
									.flatMap((b) => (b.type === "tool_call" ? [b.name.replace(/_/g, " ")] : []))
									.join(", ")}{" "}
								· Previous turn
							</p>
						)}
					</Fragment>
				);
			})}

			{(isStreaming || isPreparing) && (
				<div
					role="status"
					className="flex items-center gap-2 px-1 text-editor-caption text-muted-foreground"
				>
					<Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
					{isPreparing ? "Preparing review…" : "Thinking…"}
				</div>
			)}
			{turn.proposal && (
				<ProposalReviewPanel review={turn.proposal} updating={!!turn.updatingProposal} />
			)}
			{turn.proposalOutcome && (
				<p
					role={
						turn.proposalOutcome === "stale" || turn.proposalOutcome === "discarded"
							? "alert"
							: "status"
					}
					className="text-editor-caption text-muted-foreground"
				>
					{proposalMessages[turn.proposalOutcome]}
				</p>
			)}

			{turn.notice && (
				<div
					role="status"
					className="flex items-start gap-1.5 rounded bg-secondary/40 px-2 py-1.5 text-editor-caption2 text-muted-foreground"
				>
					<Info className="mt-0.5 h-3 w-3 shrink-0" />
					<span className="flex-1">{turn.notice}</span>
				</div>
			)}

			{turn.error && (
				<div
					role="alert"
					className="flex items-start gap-1.5 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-editor-caption leading-relaxed text-foreground"
				>
					<AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
					<span className="flex-1">{turn.error.message}</span>
				</div>
			)}

			{availability !== "already_undone" && (
				<button
					type="button"
					onClick={undoTurn}
					disabled={availability !== "undoable"}
					title={
						availability === "undoable"
							? "Undo every change this turn applied"
							: "A later edit has superseded this turn, so it can no longer be undone in one step"
					}
					className="flex items-center gap-1 self-start rounded border border-border/50 px-1.5 py-0.5 text-editor-caption2 text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:text-muted-foreground"
				>
					<Undo2 className="h-2.5 w-2.5" /> Undo this turn
				</button>
			)}
		</ChatViewport>
	);
}
