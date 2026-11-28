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
			className="flex max-h-[55%] min-h-0 min-w-0 shrink-0 flex-col border-y border-editor-line bg-editor-surface text-editor-caption [overflow-wrap:anywhere]"
		>
			<h3 id={title} className="shrink-0 px-2 py-1.5 text-editor-title3">
				Review proposed changes
			</h3>
			<div className="min-h-0 overflow-auto px-2">
				<details className="mb-2">
					<summary className="min-h-editor-icon cursor-pointer py-1">
						{included} of {review.operations.length} operations included
					</summary>
					<fieldset aria-busy={updating} className="min-w-0 space-y-1 pb-2">
						<legend className="sr-only">Include operations</legend>
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
				</details>
				{updating ? (
					<p role="status">Updating review…</p>
				) : review.blocked ? (
					<p role="alert" className="text-destructive">
						<strong>{review.blocked.operation}</strong>: {review.blocked.reason}
					</p>
				) : (
					<div className="divide-y divide-editor-line">
						<h4 className="text-editor-headline">Before and after</h4>
						<p role="status" className={deletions ? "text-destructive" : "text-muted-foreground"}>
							{deletions > 0
								? `Applying deletes ${deletions} item${deletions === 1 ? "" : "s"}.`
								: review.changes.length
									? `${review.changes.length} affected item${review.changes.length === 1 ? "" : "s"}.`
									: "No document changes selected."}
						</p>
						{review.changes.map((change) => (
							<details
								key={JSON.stringify([change.section, change.id, change.occurrence])}
								className="py-1.5"
							>
								<summary className="min-h-editor-icon cursor-pointer py-1">
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
			</div>
			<div className="flex shrink-0 flex-wrap gap-2 border-t border-editor-line p-2">
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
