import { commitToolOutcome, createTurnUndoLedger } from "@/lib/ai/loop/transaction";
import { projectCanvas } from "@/lib/canvas-projection";
import { nodeToRect } from "@/lib/canvas-utils";
import { useDocumentRegistry } from "@/stores/document-registry";
import type { DocumentStores } from "@/stores/document-stores";
import type { DocumentId } from "@/types/document";
import type { ThreatModel, TrustBoundary } from "@/types/threat-model";
import {
	buildInterviewProposal,
	type InterviewAnswers,
	type InterviewChange,
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

export function resolveInterviewSelection(review: InterviewReview): InterviewProposal {
	const names = new Map(review.expected.elements.map(({ id, name }) => [id, name]));
	for (const change of review.changes) {
		if (change.kind === "element") names.set(change.value.id, change.value.name);
	}
	const owners = new Map<string, string>();
	const gaps = [...review.gaps];
	const changes = review.changes.flatMap<InterviewChange>((change) => {
		if (!review.selected.has(change.key)) return [];
		if (change.kind !== "boundary") return [change];
		const { name, contains } = change.value;
		const members = contains.filter((id) => {
			const owner = owners.get(id);
			if (owner !== undefined) {
				gaps.push(`Boundary “${name}” excludes “${names.get(id)}”, already in “${owner}”.`);
				return false;
			}
			owners.set(id, name);
			return true;
		});
		return members.length ? [{ ...change, value: { ...change.value, contains: members } }] : [];
	});
	return { changes, gaps: [...new Set(gaps)] };
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
	const { changes } = resolveInterviewSelection(review);
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
	};
	const boundaries = changes.flatMap((change) =>
		change.kind === "boundary" ? [change.value] : [],
	);
	const result = commitToolOutcome(
		{
			status: "ok",
			result: "Interview additions applied.",
			document: boundaries.length ? placeBoundaries(document, boundaries, stores) : document,
		},
		{ expected: model, effect: "mutate", ledger: createTurnUndoLedger() },
		stores,
	);
	return result.status === "committed" ? null : result.result;
}

function placeBoundaries(
	document: ThreatModel,
	boundaries: TrustBoundary[],
	stores: DocumentStores,
): ThreatModel {
	const canvas = stores.canvas.getState();
	const { nodes } = projectCanvas(document, canvas, canvas.pendingLayout);
	const nodesById = new Map(nodes.map((node) => [node.id, node]));
	const positions = new Map<string, { x: number; y: number }>();
	const inset = 48;
	const placed = boundaries.map((boundary) => {
		const members = boundary.contains.flatMap((id) => {
			const node = nodesById.get(id);
			if (!node) return [];
			const rect = nodeToRect(node);
			const parent = node.parentId ? nodesById.get(node.parentId) : undefined;
			return [
				{
					...rect,
					id,
					x: rect.x + (parent?.position.x ?? 0),
					y: rect.y + (parent?.position.y ?? 0),
				},
			];
		});
		if (!members.length) return boundary;
		const x = Math.min(...members.map((member) => member.x)) - inset;
		const y = Math.min(...members.map((member) => member.y)) - inset;
		for (const member of members) positions.set(member.id, { x: member.x - x, y: member.y - y });
		return {
			...boundary,
			position: { x, y },
			size: {
				width: Math.max(...members.map((member) => member.x + member.width)) - x + inset,
				height: Math.max(...members.map((member) => member.y + member.height)) - y + inset,
			},
		};
	});
	return {
		...document,
		elements: document.elements.map((element) => {
			const position = positions.get(element.id);
			return position ? { ...element, position } : element;
		}),
		trust_boundaries: [...document.trust_boundaries, ...placed],
	};
}
