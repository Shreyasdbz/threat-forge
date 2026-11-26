import { commitToolOutcome, createTurnUndoLedger } from "@/lib/ai/loop/transaction";
import { useDocumentRegistry } from "@/stores/document-registry";
import type { DocumentStores } from "@/stores/document-stores";
import type { DocumentId } from "@/types/document";
import type { ThreatModel } from "@/types/threat-model";
import {
	buildInterviewProposal,
	type InterviewAnswers,
	type InterviewProposal,
} from "./interview-proposal";

export interface InterviewReview extends InterviewProposal {
	documentId: DocumentId;
	expected: ThreatModel;
	revision: string | undefined;
	selected: ReadonlySet<string>;
}

export function reviewInterview(
	stores: DocumentStores,
	answers: InterviewAnswers,
): InterviewReview | null {
	const registry = useDocumentRegistry.getState();
	const documentId = registry.activeDocumentId;
	const { model, fileRevision } = stores.model.getState();
	if (!documentId || !model || registry.getDocumentStores(documentId) !== stores) return null;
	const proposal = buildInterviewProposal(model, answers);
	return {
		...proposal,
		documentId,
		expected: model,
		revision: fileRevision,
		selected: new Set(proposal.changes.map(({ key }) => key)),
	};
}

export function selectInterviewChange(
	review: InterviewReview,
	key: string,
	include: boolean,
): InterviewReview {
	const change = review.changes.find((entry) => entry.key === key);
	if (!change) return review;
	const selected = new Set(review.selected);
	if (include) {
		selected.add(key);
		for (const requirement of change.requires) selected.add(requirement);
	} else {
		selected.delete(key);
		for (const dependant of review.changes) {
			if (dependant.requires.includes(key)) selected.delete(dependant.key);
		}
	}
	return { ...review, selected };
}

export function applyInterviewReview(
	stores: DocumentStores,
	review: InterviewReview,
): string | null {
	const registry = useDocumentRegistry.getState();
	const { model, fileRevision, fileSync } = stores.model.getState();
	if (
		registry.activeDocumentId !== review.documentId ||
		registry.getDocumentStores(review.documentId) !== stores ||
		model !== review.expected ||
		fileRevision !== review.revision ||
		fileSync === "conflict"
	) {
		return "The document changed. Rebuild the proposal before applying revisions.";
	}
	const changes = review.changes.filter(({ key }) => review.selected.has(key));
	if (!changes.length) return "Select at least one addition to apply.";
	if (changes.some(({ requires }) => requires.some((key) => !review.selected.has(key)))) {
		return "Select the required elements before applying their dependent additions.";
	}
	const document: ThreatModel = {
		...model,
		elements: [
			...model.elements,
			...changes.flatMap((change) => (change.kind === "element" ? [change.value] : [])),
		],
		data_flows: [
			...model.data_flows,
			...changes.flatMap((change) => (change.kind === "flow" ? [change.value] : [])),
		],
		trust_boundaries: [
			...model.trust_boundaries,
			...changes.flatMap((change) => (change.kind === "boundary" ? [change.value] : [])),
		],
	};
	const result = commitToolOutcome(
		{ status: "ok", result: "Interview additions applied.", document },
		{ expected: model, effect: "mutate", ledger: createTurnUndoLedger() },
		stores,
	);
	return result.status === "committed" ? null : result.result;
}
