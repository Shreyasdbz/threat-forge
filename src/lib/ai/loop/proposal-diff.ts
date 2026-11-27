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

export function diffProposal(before: ThreatModel, after: ThreatModel): ProposalChange[] {
	const changes: ProposalChange[] = [];
	const metadata = fieldChanges(before.metadata, after.metadata);
	if (metadata.length) {
		changes.push({
			section: "Document",
			id: "metadata",
			label: after.metadata.title,
			kind: "modified",
			fields: metadata,
		});
	}
	for (const key of Object.keys(collections) as (keyof typeof collections)[]) {
		if (before[key] === after[key]) continue;
		const map = (items: readonly ReviewEntity[] = []) =>
			new Map(items.map((entry) => [entry.id, entry]));
		const priorById = map(before[key]);
		const nextById = map(after[key]);
		for (const id of new Set([...priorById.keys(), ...nextById.keys()])) {
			const previous = priorById.get(id);
			const next = nextById.get(id);
			if (previous === next) continue;
			const fields = fieldChanges(previous, next).filter((change) => change.field !== "id");
			if (previous && next && fields.length === 0) continue;
			const entity = next ?? previous;
			changes.push({
				section: collections[key],
				id,
				label: entity?.name || entity?.title || id,
				kind: !previous ? "added" : !next ? "removed" : "modified",
				fields,
			});
		}
	}
	return changes;
}
