import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { nextSequenceId, sequenceDiagrams } from "@/lib/sequence-views";
import { useModelStore } from "@/stores/model-store";

export function DiagramViewControl() {
	const model = useModelStore((state) => state.model);
	const selectedId = useModelStore((state) => state.selectedSequenceId);
	const selectSequence = useModelStore((state) => state.selectSequence);
	const editDiagrams = useModelStore((state) => state.editSequenceDiagrams);
	if (!model) return null;
	const sequences = sequenceDiagrams(model);
	const activeId = sequences.some(({ id }) => id === selectedId) ? (selectedId ?? "") : "";
	return (
		<div className="flex h-10 shrink-0 items-center gap-1 border-b border-editor-line px-2">
			{sequences.length > 0 && (
				<NativeSelect
					className="max-w-36"
					aria-label="Diagram view"
					value={activeId}
					onChange={(event) => selectSequence(event.target.value || null)}
				>
					<option value="">Graph</option>
					{sequences.map(({ id, name }) => (
						<option key={id} value={id}>
							{name}
						</option>
					))}
				</NativeSelect>
			)}
			<Button
				variant="outline"
				size="sm"
				onClick={() => {
					const id = nextSequenceId("sequence", model.diagrams);
					if (
						editDiagrams([
							...model.diagrams,
							{
								id,
								name: "New sequence",
								kind: "sequence",
								sequence: { participants: [], messages: [] },
							},
						])
					)
						selectSequence(id);
				}}
			>
				New sequence
			</Button>
		</div>
	);
}
