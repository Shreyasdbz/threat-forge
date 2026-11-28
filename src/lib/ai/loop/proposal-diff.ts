import type { ThreatModel } from "@/types/threat-model";
import { canonicalJson } from "./tool-runtime";

const collections = {
	elements: "Components",
	data_flows: "Data flows",
	trust_boundaries: "Trust boundaries",
	threats: "Findings",
	relationships: "Relationships",
	groups: "Groups",
	layers: "Layers",
	diagrams: "Diagrams",
} as const;

interface ReviewEntity {
	id: string;
	name?: string;
	title?: string;
}

export interface ProposalFieldChange {
	field: string;
	before: unknown;
	after: unknown;
}

export interface ProposalChange {
	section: string;
	id: string;
	occurrence: number;
	label: string;
	kind: "added" | "modified" | "removed";
	fields: ProposalFieldChange[];
}

function fieldChanges(
	before: object | undefined,
	after: object | undefined,
): ProposalFieldChange[] {
	const previous = new Map(Object.entries(before ?? {}));
	const next = new Map(Object.entries(after ?? {}));
	const keys = [...new Set([...previous.keys(), ...next.keys()])].sort();
	return keys
		.filter((key) => canonicalJson(previous.get(key)) !== canonicalJson(next.get(key)))
		.map((field) => ({ field, before: previous.get(field), after: next.get(field) }));
}

function byId(items: readonly ReviewEntity[] = []): Map<string, ReviewEntity[]> {
	const groups = new Map<string, ReviewEntity[]>();
	for (const item of items) {
		const entries = groups.get(item.id);
		if (entries) entries.push(item);
		else groups.set(item.id, [item]);
	}
	return groups;
}

function unmatched(items: ReviewEntity[], other: ReviewEntity[]): ReviewEntity[] {
	const counts = new Map<string, number>();
	for (const entry of other) {
		const key = canonicalJson(entry);
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	return items.filter((entry) => {
		const key = canonicalJson(entry);
		const count = counts.get(key) ?? 0;
		if (count === 0) return true;
		counts.set(key, count - 1);
		return false;
	});
}

export function diffProposal(before: ThreatModel, after: ThreatModel): ProposalChange[] {
	const changes: ProposalChange[] = [];
	const metadata = fieldChanges(before.metadata, after.metadata);
	if (metadata.length) {
		changes.push({
			section: "Document",
			id: "metadata",
			occurrence: 0,
			label: after.metadata.title,
			kind: "modified",
			fields: metadata,
		});
	}
	for (const key of Object.keys(collections) as (keyof typeof collections)[]) {
		if (before[key] === after[key]) continue;
		const priorById = byId(before[key]);
		const nextById = byId(after[key]);
		for (const id of new Set([...priorById.keys(), ...nextById.keys()])) {
			const prior = priorById.get(id) ?? [];
			const current = nextById.get(id) ?? [];
			const repeated = prior.length > 1 || current.length > 1;
			const left = repeated ? unmatched(prior, current) : prior;
			const right = repeated ? unmatched(current, prior) : current;
			for (let occurrence = 0; occurrence < Math.max(left.length, right.length); occurrence++) {
				const previous = left[occurrence];
				const next = right[occurrence];
				if (previous === next) continue;
				const fields = fieldChanges(previous, next).filter((change) => change.field !== "id");
				if (previous && next && fields.length === 0) continue;
				const entity = next ?? previous;
				changes.push({
					section: collections[key],
					id,
					occurrence,
					label: entity?.name || entity?.title || id,
					kind: !previous ? "added" : !next ? "removed" : "modified",
					fields,
				});
			}
		}
	}
	return changes;
}
