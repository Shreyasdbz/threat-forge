import { useId } from "react";
import { Button } from "@/components/ui/button";
import type { ProposalReview } from "@/lib/ai/loop/turn-proposal";
import { useAiTurnStore } from "@/stores/ai-turn-store";

const changeLabels = { added: "Add", modified: "Change", removed: "Delete" };

function formatValue(value: unknown): string {
	return value === undefined ? "Not set" : JSON.stringify(value);
}

export function ProposalReviewPanel({
	review,
	updating,
}: {
	review: ProposalReview;
	updating: boolean;
}) {
	const title = useId();
	const select = useAiTurnStore((s) => s.selectProposal);
	const apply = useAiTurnStore((s) => s.applyProposal);
	const reject = useAiTurnStore((s) => s.rejectProposal);
	const deletions = review.changes.filter(({ kind }) => kind === "removed").length;
	const included = review.operations.filter((operation) => operation.included).length;

	return (
		<section
			aria-labelledby={title}
			className="min-w-0 space-y-3 rounded-lg border border-border p-3 text-xs [overflow-wrap:anywhere]"
		>
			<h3 id={title} className="font-semibold">
				Review proposed changes
			</h3>
			<p className="text-muted-foreground">
				Your document stays unchanged until you apply this proposal.
			</p>
			<fieldset aria-busy={updating} className="min-w-0 space-y-2">
				<legend className="mb-1 font-medium">Include operations</legend>
				{review.operations.map((operation) => (
					<label key={operation.id} className="flex items-start gap-2">
						<input
							type="checkbox"
							checked={operation.included}
							aria-disabled={updating}
							onChange={(event) => {
								if (updating) return;
								const checked = event.currentTarget.checked;
								select(
									review.token,
									review.operations
										.filter((item) => (item.id === operation.id ? checked : item.included))
										.map(({ id }) => id),
								);
							}}
							className="mt-0.5 shrink-0 accent-primary"
						/>
						<span className="min-w-0 whitespace-pre-wrap">{operation.summary}</span>
					</label>
				))}
			</fieldset>
			{updating ? (
				<p role="status">Updating review…</p>
			) : review.blocked ? (
				<p role="alert" className="text-destructive">
					<strong>{review.blocked.operation}</strong>: {review.blocked.reason}
				</p>
			) : (
				<div className="space-y-2">
					<h4 className="font-medium">Before and after</h4>
					<p role="status" className={deletions ? "text-destructive" : "text-muted-foreground"}>
						{deletions > 0
							? `Applying deletes ${deletions} item${deletions === 1 ? "" : "s"}.`
							: review.changes.length
								? `${review.changes.length} affected item${review.changes.length === 1 ? "" : "s"}.`
								: "No document changes selected."}
					</p>
					{review.changes.map((change) => (
						<details
							key={JSON.stringify([change.section, change.id])}
							className="rounded border border-border p-2"
						>
							<summary className="cursor-pointer">
								{changeLabels[change.kind]} · {change.section} · <bdi>{change.label}</bdi>
							</summary>
							<p className="mt-2 text-muted-foreground">
								ID: <bdi>{change.id}</bdi>
							</p>
							{change.fields.map(({ field, before, after }) => (
								<dl key={field} className="mt-2 border-t border-border pt-2">
									<div className="font-medium">
										<dt className="sr-only">Field</dt>
										<dd>{field}</dd>
									</div>
									<div className="mt-1">
										<dt className="text-muted-foreground">Before</dt>
										<dd className="whitespace-pre-wrap">
											<bdi>{formatValue(before)}</bdi>
										</dd>
									</div>
									<div className="mt-1">
										<dt className="text-muted-foreground">After</dt>
										<dd className="whitespace-pre-wrap">
											<bdi>{formatValue(after)}</bdi>
										</dd>
									</div>
								</dl>
							))}
						</details>
					))}
				</div>
			)}
			<div className="flex flex-wrap gap-2">
				<Button
					size="sm"
					variant={deletions ? "destructive" : "default"}
					disabled={updating || !!review.blocked || !review.changes.length}
					onClick={() => apply(review.token)}
				>
					{deletions
						? "Apply with deletions"
						: included === review.operations.length
							? "Apply proposal"
							: "Apply selected"}
				</Button>
				<Button size="sm" variant="outline" onClick={() => reject(review.token)}>
					Reject proposal
				</Button>
			</div>
		</section>
	);
}
