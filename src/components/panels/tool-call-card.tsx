/**
 * Tool call results for the bounded tool loop.
 *
 * Each card renders one of the seven call statuses with the affordances from the
 * turn machine's status table. Every piece of model-derived text — the summary,
 * the result, the failure message — is rendered as **text**, never through
 * `MarkdownContent`, preserving the deliberate omission of raw-HTML rendering
 * (`markdown-content.tsx`). The status-to-affordance map is exhaustive over the
 * status union, so a new status fails `tsc --noEmit` rather than rendering
 * nothing.
 */

import { AlertCircle, Ban, Check, Loader2, Play, Undo2 } from "lucide-react";
import { useState } from "react";
import type { DenialReason } from "@/lib/ai/loop/authorization";
import type { CallStatus } from "@/lib/ai/loop/turn-machine";
import { cn } from "@/lib/utils";
import type { ToolCallPresentation } from "@/types/chat-session";

/** Longest untrusted text shown before it collapses behind an expander. */
const TEXT_PREVIEW_LIMIT = 240;

const CREATION_TOOLS = new Set([
	"add_element",
	"add_data_flow",
	"add_trust_boundary",
	"add_threat",
]);

function assertNever(value: never): never {
	throw new Error(`Unhandled call status: ${String(value)}`);
}

/** Render untrusted model text as plain text, length-capped with an expander. */
function ExpandableText({ text }: { text: string }) {
	const [expanded, setExpanded] = useState(false);
	if (text.length <= TEXT_PREVIEW_LIMIT) {
		return <span className="whitespace-pre-wrap break-words">{text}</span>;
	}
	const shown = expanded ? text : `${text.slice(0, TEXT_PREVIEW_LIMIT)}…`;
	return (
		<span className="whitespace-pre-wrap break-words">
			{shown}{" "}
			<button
				type="button"
				onClick={() => setExpanded((prev) => !prev)}
				className="text-primary underline"
			>
				{expanded ? "Show less" : "Show more"}
			</button>
		</span>
	);
}

/** A neutral status chip with no action. */
function StatusChip({ label, tone }: { label: string; tone: "muted" | "error" | "success" }) {
	return (
		<span
			className={cn(
				"shrink-0 rounded-md px-2 py-1 text-[11px] font-medium",
				tone === "muted" && "bg-secondary/60 text-muted-foreground",
				tone === "error" && "bg-destructive/10 text-destructive",
				tone === "success" && "bg-green-500/10 text-green-600 dark:text-green-500",
			)}
		>
			{label}
		</span>
	);
}

/** The label a denied call shows, distinguishing a user refusal from a not-run call. */
function deniedLabel(reason: DenialReason | null): string {
	return reason === "user_declined" ? "Declined" : "Not run";
}

export interface ToolCallCardProps {
	call: ToolCallPresentation;
}

/** One tool call, rendered per its status. */
export function ToolCallCard({ call }: ToolCallCardProps) {
	// Creation IDs are provider feedback; the readable summary and chip show the outcome here.
	const creationApplied =
		CREATION_TOOLS.has(call.toolName) && (call.status === "succeeded" || call.status === "undone");
	return (
		<div
			data-testid={`tool-call-${call.id}`}
			data-status={call.status}
			className={cn(
				"flex items-start gap-2 rounded-lg border p-2.5 text-xs leading-relaxed",
				call.status === "failed" || (call.status === "denied" && call.isError)
					? "border-destructive/30 bg-background/50"
					: "border-border/50 bg-background/50",
			)}
		>
			<CallIcon status={call.status} />
			<div className="min-w-0 flex-1">
				<div className={cn(call.status === "undone" && "line-through opacity-70")}>
					{call.destructive ? (
						<span className="whitespace-pre-wrap break-words">{call.summary}</span>
					) : (
						<ExpandableText text={call.summary} />
					)}
				</div>
				{call.result !== null &&
					!creationApplied &&
					call.status !== "pending" &&
					call.status !== "approved" && (
						<div
							className={cn(
								"mt-0.5 text-[11px]",
								call.isError ? "text-destructive" : "text-muted-foreground",
							)}
						>
							<ExpandableText text={call.result} />
						</div>
					)}
			</div>
			<CallAffordance call={call} />
		</div>
	);
}

function CallIcon({ status }: { status: CallStatus }) {
	switch (status) {
		case "pending":
		case "approved":
			return <Play className="mt-0.5 h-3 w-3 shrink-0 text-primary" />;
		case "running":
			return <Loader2 className="mt-0.5 h-3 w-3 shrink-0 animate-spin text-muted-foreground" />;
		case "succeeded":
			return <Check className="mt-0.5 h-3 w-3 shrink-0 text-green-600 dark:text-green-500" />;
		case "failed":
			return <AlertCircle className="mt-0.5 h-3 w-3 shrink-0 text-destructive" />;
		case "denied":
			return <Ban className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />;
		case "undone":
			return <Undo2 className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />;
		default:
			return assertNever(status);
	}
}

function CallAffordance({ call }: ToolCallCardProps) {
	switch (call.status) {
		case "pending":
			return <StatusChip label="Awaiting review" tone="muted" />;
		case "approved":
			return <StatusChip label="Queued" tone="muted" />;
		case "running":
			return <StatusChip label="Preparing…" tone="muted" />;
		case "succeeded":
			return <StatusChip label="Applied" tone="success" />;
		case "failed":
			return <StatusChip label="Failed" tone="error" />;
		case "undone":
			return <StatusChip label="Undone" tone="muted" />;
		case "denied":
			return <StatusChip label={deniedLabel(call.denialReason)} tone="muted" />;
		default:
			return assertNever(call.status);
	}
}
