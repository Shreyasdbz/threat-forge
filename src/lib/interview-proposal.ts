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
	const refs = new Map(model.elements.map(({ id }) => [`existing:${id}`, { id, dependency: "" }]));
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
		refs.set(`answer:${answer.key}`, { id, dependency: key });
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
	for (const answer of answers.boundaries) {
		const name = answer.name.trim();
		const members = answer.members.flatMap((ref) => refs.get(ref) ?? []);
		if (!name || !members.length || members.length !== answer.members.length) {
			gaps.push("A boundary needs a name and valid members.");
			continue;
		}
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
