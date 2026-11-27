import { type ReactNode, useId } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { moveSequenceRow, nextSequenceId, type SequenceDiagram } from "@/lib/sequence-views";
import type {
	SequenceMessage,
	SequenceParticipant,
	SequenceView,
	ThreatModel,
} from "@/types/threat-model";

interface SequenceEditorProps {
	diagram: SequenceDiagram;
	model: ThreatModel;
	onChange: (diagram: SequenceDiagram) => void;
	onDelete: () => void;
	onOpenFlow: (id: string) => void;
}

export function SequenceEditor({
	diagram,
	model,
	onChange,
	onDelete,
	onOpenFlow,
}: SequenceEditorProps) {
	const { participants, messages } = diagram.sequence;
	const elements = new Map(model.elements.map((element) => [element.id, element.name]));
	const unused = model.elements.filter(
		(element) => !participants.some((row) => row.element_id === element.id),
	);
	const update = (change: Partial<SequenceView>) =>
		onChange({ ...diagram, sequence: { ...diagram.sequence, ...change } });
	const nameOf = (id: string) => {
		const participant = participants.find((row) => row.id === id);
		return participant && (elements.get(participant.element_id) ?? participant.element_id);
	};

	return (
		<section
			aria-label="Sequence editor"
			className="@container/sequence h-full overflow-auto bg-editor-canvas px-4 py-6"
		>
			<div className="mx-auto grid max-w-5xl gap-6">
				<header className="flex flex-wrap items-end justify-between gap-2">
					<Field label="Sequence name">
						{(id) => (
							<CommitInput
								id={id}
								value={diagram.name}
								onCommit={(name) => {
									if (name.trim()) onChange({ ...diagram, name: name.trim() });
								}}
							/>
						)}
					</Field>
					<Button variant="outline" size="sm" onClick={onDelete}>
						Delete sequence
					</Button>
				</header>
				<section aria-labelledby="sequence-lifelines">
					<h2 id="sequence-lifelines" className="mb-2 text-editor-headline">
						Lifelines
					</h2>
					<ol className="divide-y divide-editor-line border-y border-editor-line">
						{participants.map((participant, index) => (
							<li
								key={participant.id}
								className="flex min-h-editor-row flex-wrap items-center justify-between gap-2 py-1"
							>
								<span>
									{index + 1}. {nameOf(participant.id)}
								</span>
								<RowActions
									label={nameOf(participant.id) ?? participant.id}
									index={index}
									size={participants.length}
									onMove={(offset) =>
										update({ participants: moveSequenceRow(participants, index, offset) })
									}
									onRemove={() =>
										update({
											participants: participants.filter((row) => row.id !== participant.id),
										})
									}
									removeDisabled={messages.some(
										(row) => row.from === participant.id || row.to === participant.id,
									)}
								/>
							</li>
						))}
					</ol>
					<NativeSelect
						className="mt-2"
						aria-label="Add lifeline"
						value=""
						disabled={!unused.length}
						onChange={(event) => {
							const element_id = event.target.value;
							if (element_id)
								update({
									participants: [
										...participants,
										{ id: nextSequenceId("lifeline", participants), element_id },
									],
								});
						}}
					>
						<option value="">Add an existing element…</option>
						{unused.map((element) => (
							<option key={element.id} value={element.id}>
								{element.name}
							</option>
						))}
					</NativeSelect>
				</section>
				<section aria-labelledby="sequence-messages">
					<h2 id="sequence-messages" className="mb-2 text-editor-headline">
						Messages
					</h2>
					<ol className="divide-y divide-editor-line border-y border-editor-line">
						{messages.map((message, index) => (
							<li
								key={message.id}
								className="grid gap-2 py-2 @min-[42rem]/sequence:grid-cols-[minmax(0,1fr)_auto] @min-[42rem]/sequence:items-end"
							>
								<MessageFields
									message={message}
									index={index}
									participants={participants}
									nameOf={nameOf}
									model={model}
									onOpenFlow={onOpenFlow}
									onChange={(edited) =>
										update({
											messages: messages.map((row) => (row.id === message.id ? edited : row)),
										})
									}
								/>
								<RowActions
									label={`message ${index + 1}`}
									index={index}
									size={messages.length}
									onMove={(offset) =>
										update({ messages: moveSequenceRow(messages, index, offset) })
									}
									onRemove={() =>
										update({ messages: messages.filter((row) => row.id !== message.id) })
									}
								/>
							</li>
						))}
					</ol>
					<Button
						className="mt-2"
						variant="outline"
						size="sm"
						disabled={!participants.length}
						onClick={() => {
							const first = participants[0];
							if (!first) return;
							update({
								messages: [
									...messages,
									{
										id: nextSequenceId("message", messages),
										from: first.id,
										to: (participants[1] ?? first).id,
										label: "New message",
									},
								],
							});
						}}
					>
						Add message
					</Button>
				</section>
			</div>
		</section>
	);
}

function MessageFields({
	message,
	index,
	participants,
	nameOf,
	model,
	onChange,
	onOpenFlow,
}: {
	message: SequenceMessage;
	index: number;
	participants: SequenceParticipant[];
	nameOf: (id: string) => string | undefined;
	model: ThreatModel;
	onChange: (message: SequenceMessage) => void;
	onOpenFlow: (id: string) => void;
}) {
	const number = index + 1;
	const elementOf = (id: string) =>
		participants.find((participant) => participant.id === id)?.element_id;
	const matchingFlows = model.data_flows.filter(
		(flow) => flow.from === elementOf(message.from) && flow.to === elementOf(message.to),
	);
	const choices = participants.map(({ id }) => (
		<option key={id} value={id}>
			{nameOf(id)}
		</option>
	));
	return (
		<div className="grid min-w-0 grid-cols-2 items-end gap-2 @min-[42rem]/sequence:grid-cols-[1.3fr_1fr_1fr_1fr]">
			<Field label={`Message ${number} label`}>
				{(id) => (
					<CommitInput
						id={id}
						value={message.label}
						onCommit={(label) => onChange({ ...message, label })}
					/>
				)}
			</Field>
			<Field label={`Message ${number} linked flow`}>
				{(id) => (
					<NativeSelect
						className="h-editor-control rounded-editor-control"
						id={id}
						value={message.flow_id ?? ""}
						onChange={(event) => {
							const { flow_id: _previous, ...rest } = message;
							const id = event.target.value;
							onChange(id ? { ...rest, flow_id: id } : rest);
						}}
					>
						<option value="">Unlinked annotation</option>
						{matchingFlows.map((flow) => (
							<option key={flow.id} value={flow.id}>
								{flow.name} ({flow.id})
							</option>
						))}
					</NativeSelect>
				)}
			</Field>
			{(["from", "to"] as const).map((end) => (
				<Field key={end} label={`Message ${number} ${end}`}>
					{(id) => (
						<NativeSelect
							id={id}
							value={message[end]}
							disabled={!!message.flow_id}
							onChange={(event) => onChange({ ...message, [end]: event.target.value })}
						>
							{choices}
						</NativeSelect>
					)}
				</Field>
			))}
			{message.flow_id && (
				<Button
					variant="ghost"
					size="sm"
					className="col-span-full justify-self-start"
					onClick={() => {
						if (message.flow_id) onOpenFlow(message.flow_id);
					}}
				>
					Show linked flow and findings
				</Button>
			)}
		</div>
	);
}

function Field({ label, children }: { label: string; children: (id: string) => ReactNode }) {
	const id = useId();
	return (
		<label htmlFor={id} className="grid min-w-0 gap-1 text-editor-caption">
			{label}
			{children(id)}
		</label>
	);
}

function CommitInput({
	id,
	value,
	onCommit,
}: {
	id: string;
	value: string;
	onCommit: (value: string) => void;
}) {
	return (
		<Input
			id={id}
			className="h-editor-control rounded-editor-control"
			data-sequence-draft
			key={value}
			defaultValue={value}
			onBlur={(event) => {
				if (event.target.value !== value) onCommit(event.target.value);
			}}
			onKeyDown={(event) => {
				if (event.key === "Enter") event.currentTarget.blur();
			}}
		/>
	);
}

function RowActions({
	label,
	index,
	size,
	onMove,
	onRemove,
	removeDisabled,
}: {
	label: string;
	index: number;
	size: number;
	onMove: (offset: -1 | 1) => void;
	onRemove: () => void;
	removeDisabled?: boolean;
}) {
	return (
		<div className="flex flex-wrap gap-1 self-start">
			<Button
				variant="ghost"
				size="sm"
				aria-label={`Move ${label} up`}
				disabled={index === 0}
				onClick={() => onMove(-1)}
			>
				↑
			</Button>
			<Button
				variant="ghost"
				size="sm"
				aria-label={`Move ${label} down`}
				disabled={index === size - 1}
				onClick={() => onMove(1)}
			>
				↓
			</Button>
			<Button
				variant="ghost"
				size="sm"
				aria-label={`Remove ${label}`}
				disabled={removeDisabled}
				onClick={onRemove}
			>
				Remove
			</Button>
		</div>
	);
}
