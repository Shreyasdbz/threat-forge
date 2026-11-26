import { nextSequenceId } from "@/lib/sequence-views";
import type { DataFlow, Element, ThreatModel, TrustBoundary } from "@/types/threat-model";

export type InterviewRole = "external_entity" | "process" | "data_store";
export type InterviewElement = { key: number; role: InterviewRole; name: string; reuse: string };
export type InterviewFlow = { key: number; name: string; from: string; to: string; data: string };
export type InterviewBoundary = { key: number; name: string; members: string[] };

export interface InterviewAnswers {
	scope: string;
	assets: string;
	elements: InterviewElement[];
	flows: InterviewFlow[];
	boundaries: InterviewBoundary[];
}

export type InterviewChange = (
	| { kind: "element"; value: Element }
	| { kind: "flow"; value: DataFlow }
	| { kind: "boundary"; value: TrustBoundary }
) & { key: string; requires: string[] };

export interface InterviewProposal {
	changes: InterviewChange[];
	gaps: string[];
}

export function interviewElements(model: ThreatModel, answers: InterviewAnswers) {
	return [
		...model.elements.map(({ id, name }) => ({ ref: `existing:${id}`, name })),
		...answers.elements
			.filter(({ name, reuse }) => !reuse && name.trim())
			.map(({ key, name }) => ({ ref: `answer:${key}`, name: `${name.trim()} (new)` })),
	];
}

export function interviewBoundaryMemberRef(ref: string, elements: InterviewElement[]): string {
	if (!ref.startsWith("answer:")) return ref;
	const answer = elements.find(({ key }) => ref === `answer:${key}`);
	return answer?.reuse ? `existing:${answer.reuse}` : ref;
}

export function buildInterviewProposal(
	model: ThreatModel,
	answers: InterviewAnswers,
): InterviewProposal {
	const changes: InterviewChange[] = [];
	const gaps: string[] = [];
	const reserved: { id: string }[] = [
		...model.elements,
		...model.data_flows,
		...model.trust_boundaries,
	];
	const refs = new Map(
		model.elements.map(({ id, name }) => [`existing:${id}`, { id, name, dependency: "" }]),
	);
	const makeId = (key: string) => {
		const id = nextSequenceId(`interview-${key}`, reserved);
		reserved.push({ id });
		return id;
	};
	if (!answers.scope.trim()) gaps.push("System scope not answered.");
	if (!answers.assets.trim()) gaps.push("Assets not answered.");
	if (!answers.elements.some(({ role }) => role !== "data_store")) {
		gaps.push("Actors and services not answered.");
	}
	if (!answers.elements.some(({ role }) => role === "data_store"))
		gaps.push("Stores not answered.");
	if (!answers.flows.length) gaps.push("Directional flows not answered.");
	if (!answers.boundaries.length) gaps.push("Trust boundaries not answered.");

	for (const answer of answers.elements) {
		if (answer.reuse) {
			if (!model.elements.some(({ id }) => id === answer.reuse)) {
				gaps.push("A selected existing element is no longer available.");
			}
			continue;
		}
		const name = answer.name.trim();
		if (!name) {
			gaps.push("An element needs a name.");
			continue;
		}
		const key = `element-${answer.key}`;
		const id = makeId(key);
		refs.set(`answer:${answer.key}`, { id, name, dependency: key });
		changes.push({
			key,
			kind: "element",
			requires: [],
			value: { id, name, type: answer.role, trust_zone: "", description: "", technologies: [] },
		});
	}
	for (const answer of answers.flows) {
		const name = answer.name.trim();
		const from = refs.get(answer.from);
		const to = refs.get(answer.to);
		if (!name || !from || !to) {
			gaps.push("A flow needs a name and both endpoints.");
			continue;
		}
		const key = `flow-${answer.key}`;
		changes.push({
			key,
			kind: "flow",
			requires: [...new Set([from.dependency, to.dependency].filter(Boolean))],
			value: {
				id: makeId(key),
				name,
				from: from.id,
				to: to.id,
				protocol: "",
				data: answer.data
					.split(",")
					.map((item) => item.trim())
					.filter(Boolean),
				authenticated: false,
			},
		});
	}
	const ownerByMember = new Map<string, string>();
	for (const boundary of model.trust_boundaries) {
		for (const id of boundary.contains) {
			if (!ownerByMember.has(id)) ownerByMember.set(id, boundary.name);
		}
	}
	for (const answer of answers.boundaries) {
		const name = answer.name.trim();
		const resolved = answer.members.flatMap(
			(ref) => refs.get(interviewBoundaryMemberRef(ref, answers.elements)) ?? [],
		);
		if (!name || !resolved.length) {
			gaps.push("A boundary needs a name and valid members.");
			continue;
		}
		if (resolved.length !== answer.members.length) {
			gaps.push(`Boundary “${name}” has unavailable members.`);
		}
		const members = resolved.filter((member) => {
			const owner = ownerByMember.get(member.id);
			if (owner === undefined) return true;
			gaps.push(`Boundary “${name}” excludes “${member.name}”, already in “${owner}”.`);
			return false;
		});
		if (!members.length) continue;
		const key = `boundary-${answer.key}`;
		changes.push({
			key,
			kind: "boundary",
			requires: [...new Set(members.map(({ dependency }) => dependency).filter(Boolean))],
			value: { id: makeId(key), name, contains: [...new Set(members.map(({ id }) => id))] },
		});
	}
	return { changes, gaps: [...new Set(gaps)] };
}
