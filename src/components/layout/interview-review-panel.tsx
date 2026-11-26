import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	applyInterviewReview,
	reviewInterview,
	selectInterviewChange,
} from "@/lib/interview-review";
import type { DocumentStores } from "@/stores/document-stores";
import type { InterviewDraft } from "@/stores/interview-store";

export function InterviewReviewPanel({
	stores,
	draft,
}: {
	stores: DocumentStores;
	draft: InterviewDraft;
}) {
	const [error, setError] = useState<string | null>(null);
	const { update, complete } = stores.interview.getState();
	const review = draft.review;
	function rebuild() {
		update((state) => ({ ...state, review: reviewInterview(stores, state.answers) }));
		setError(null);
	}
	if (!review) return <Button onClick={rebuild}>Build proposal</Button>;
	const names = new Map(review.expected.elements.map(({ id, name }) => [id, name]));
	for (const change of review.changes) {
		if (change.kind === "element") names.set(change.value.id, change.value.name);
	}
	return (
		<div className="space-y-3 text-editor-body">
			<h3 className="font-semibold">Proposed additions</h3>
			{review.changes.length ? (
				<ul className="space-y-2">
					{review.changes.map((change) => {
						const { key, kind, value, requires } = change;
						return (
							<li key={key} className="border border-editor-line p-2">
								<label className="flex items-center gap-2 font-medium">
									<input
										type="checkbox"
										checked={review.selected.has(key)}
										onChange={(event) => {
											const checked = event.target.checked;
											update((state) => ({
												...state,
												review: state.review
													? selectInterviewChange(state.review, key, checked)
													: null,
											}));
										}}
									/>
									{value.name} ({kind})
								</label>
								{change.kind === "flow" && (
									<p className="ml-5 text-muted-foreground">
										{names.get(change.value.from)} → {names.get(change.value.to)}
										{change.value.data.length > 0 && ` · ${change.value.data.join(", ")}`}
									</p>
								)}
								{change.kind === "boundary" && (
									<p className="ml-5 text-muted-foreground">
										Members: {change.value.contains.map((id) => names.get(id)).join(", ")}
									</p>
								)}
								{requires.length > 0 && (
									<p className="ml-5 text-muted-foreground">
										Requires:{" "}
										{requires
											.map((key) => review.changes.find((entry) => entry.key === key)?.value.name)
											.join(", ")}
									</p>
								)}
							</li>
						);
					})}
				</ul>
			) : (
				<p>No additions proposed.</p>
			)}
			{review.gaps.length > 0 && (
				<>
					<h3 className="font-semibold">Unanswered questions</h3>
					<ul className="list-disc pl-5">
						{review.gaps.map((gap) => (
							<li key={gap}>{gap}</li>
						))}
					</ul>
				</>
			)}
			{error && (
				<p role="alert" className="text-destructive">
					{error}
				</p>
			)}
			<div className="flex flex-wrap gap-2">
				<Button variant="outline" onClick={rebuild}>
					Rebuild proposal
				</Button>
				<Button
					disabled={!review.selected.size}
					onClick={() => {
						const refusal = applyInterviewReview(stores, review);
						if (refusal) setError(refusal);
						else complete();
					}}
				>
					Apply selected changes
				</Button>
			</div>
		</div>
	);
}
