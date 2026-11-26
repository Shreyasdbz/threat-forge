import type { Diagram, SequenceView, ThreatModel } from "@/types/threat-model";

export type SequenceDiagram = Diagram & { sequence: SequenceView };

export function sequenceDiagrams(model: ThreatModel | null): SequenceDiagram[] {
	// Document readers and sequence mutations validate the payload before it reaches the editor.
	return model?.version === "1.1"
		? model.diagrams.filter(
				(diagram): diagram is SequenceDiagram =>
					diagram.kind === "sequence" && diagram.sequence != null,
			)
		: [];
}

export function showingSequence({
	model,
	selectedSequenceId,
}: {
	model: ThreatModel | null;
	selectedSequenceId: string | null;
}): boolean {
	return (
		selectedSequenceId !== null &&
		sequenceDiagrams(model).some(({ id }) => id === selectedSequenceId)
	);
}

export function nextSequenceId(prefix: string, rows: readonly { id: string }[]): string {
	const ids = new Set(rows.map(({ id }) => id));
	let number = 1;
	while (ids.has(`${prefix}-${number}`)) number++;
	return `${prefix}-${number}`;
}

export function moveSequenceRow<T>(rows: readonly T[], index: number, offset: -1 | 1): T[] {
	const next = [...rows];
	const target = index + offset;
	if (index >= 0 && index < next.length && target >= 0 && target < next.length) {
		[next[index], next[target]] = [next[target], next[index]];
	}
	return next;
}
