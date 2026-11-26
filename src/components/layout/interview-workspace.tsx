import { type ReactNode, useId } from "react";
import { useStore } from "zustand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
	type InterviewAnswers,
	interviewElements,
	interviewExistingBoundaries,
} from "@/lib/interview-proposal";
import { reviewInterview } from "@/lib/interview-review";
import { useActiveStores } from "@/stores/document-stores";
import type { InterviewDraft } from "@/stores/interview-store";
import { useUiStore } from "@/stores/ui-store";
import type { ThreatModel } from "@/types/threat-model";
import { InterviewReviewPanel } from "./interview-review-panel";

const STEPS = [
	"Scope and assets",
	"Actors and services",
	"Data stores",
	"Directional flows",
	"Trust boundaries",
	"Proposal",
];

export function InterviewControl() {
	const { interview } = useActiveStores();
	const resumable = useStore(interview, (state) => !!state.draft || state.applied);
	return (
		<div className="flex h-10 shrink-0 items-center border-b border-editor-line pr-2">
			<Button variant="outline" size="sm" onClick={interview.getState().start}>
				{resumable ? "Resume interview" : "Guided interview"}
			</Button>
		</div>
	);
}

export function InterviewWorkspace({ children }: { children: ReactNode }) {
	const stores = useActiveStores();
	const { interview, model: modelStore } = stores;
	const draft = useStore(interview, (state) => (state.visible ? state.draft : null));
	const applied = useStore(interview, (state) => state.visible && state.applied);
	const model = useStore(modelStore, (state) => state.model);
	const { update, hide, discard } = interview.getState();
	const showing = (!!draft || applied) && !!model;
	const advance = () =>
		update((state) => ({
			...state,
			step: state.step + 1,
			review: state.step === STEPS.length - 2 ? reviewInterview(stores, state.answers) : null,
		}));
	return (
		<div className="relative h-full">
			<div className={showing ? "invisible h-full" : "h-full"} inert={showing}>
				{children}
			</div>
			{applied && (
				<section
					aria-label="Interview additions applied"
					className="absolute inset-0 space-y-4 overflow-auto bg-editor-surface p-5"
				>
					<h2 className="text-editor-title3">Interview additions applied</h2>
					<p className="text-editor-body">
						The model is updated. You can undo these additions together or review threats
						separately.
					</p>
					<div className="flex flex-wrap gap-2">
						<Button variant="outline" onClick={discard}>
							Return to diagram
						</Button>
						<Button
							onClick={() => {
								discard();
								modelStore.getState().selectSequence(null);
								const ui = useUiStore.getState();
								if (!ui.rightPanelOpen) ui.toggleRightPanel();
								ui.setRightPanelTab("threats");
							}}
						>
							Open STRIDE review
						</Button>
					</div>
				</section>
			)}
			{draft && model && (
				<section
					aria-label="Guided interview"
					className="absolute inset-0 overflow-auto bg-editor-surface p-5"
				>
					<div className="mx-auto max-w-3xl space-y-4">
						<div className="flex flex-wrap items-start justify-between gap-2">
							<div>
								<p className="text-editor-caption text-muted-foreground">
									Guided interview · {draft.step + 1} of {STEPS.length}
								</p>
								<h2 className="text-editor-title3">{STEPS[draft.step]}</h2>
							</div>
							<Button size="sm" variant="outline" onClick={hide}>
								Return to diagram
							</Button>
						</div>
						<p className="text-editor-caption text-muted-foreground">
							Answers stay in this tab and are discarded when you cancel, close, or reload. They are
							not saved to the file.
						</p>
						{draft.step === STEPS.length - 1 ? (
							<InterviewReviewPanel key={draft.review?.documentId} stores={stores} draft={draft} />
						) : (
							<Questions model={model} draft={draft} update={update} />
						)}
						<div className="flex flex-wrap items-center gap-2 border-t border-editor-line pt-3">
							<Button variant="ghost" onClick={discard}>
								Cancel interview
							</Button>
							<div className="flex-1" />
							<Button
								variant="outline"
								disabled={draft.step === 0}
								onClick={() =>
									update((state) => ({ ...state, step: state.step - 1, review: null }))
								}
							>
								Back
							</Button>
							{draft.step < STEPS.length - 1 && (
								<>
									<Button variant="ghost" onClick={advance}>
										Skip
									</Button>
									<Button onClick={advance}>
										{draft.step === STEPS.length - 2 ? "Review changes" : "Continue"}
									</Button>
								</>
							)}
						</div>
					</div>
				</section>
			)}
		</div>
	);
}

function Field({ label, children }: { label: string; children: (id: string) => ReactNode }) {
	const id = useId();
	return (
		<label htmlFor={id} className="grid gap-1 text-editor-caption">
			{label}
			{children(id)}
		</label>
	);
}

function Questions({
	model,
	draft,
	update,
}: {
	model: ThreatModel;
	draft: InterviewDraft;
	update: (change: (draft: InterviewDraft) => InterviewDraft) => void;
}) {
	const { answers, step } = draft;
	function edit<K extends keyof InterviewAnswers>(
		key: K,
		mutate: (value: InterviewAnswers[K]) => InterviewAnswers[K],
	) {
		update((state) => ({
			...state,
			answers: { ...state.answers, [key]: mutate(state.answers[key]) },
		}));
	}
	function add<K extends "elements" | "flows">(key: K, row: InterviewAnswers[K][number]) {
		update((state) => ({
			...state,
			nextKey: state.nextKey + 1,
			answers: { ...state.answers, [key]: [...state.answers[key], { ...row, key: state.nextKey }] },
		}));
	}
	function removeElement(key: number) {
		update((state) => {
			const { boundaries, elements } = state.answers;
			const memberOf = { ...boundaries.memberOf };
			delete memberOf[`answer:${key}`];
			return {
				...state,
				answers: {
					...state.answers,
					elements: elements.filter((element) => element.key !== key),
					boundaries: { ...boundaries, memberOf },
				},
			};
		});
	}
	function changeReuse(key: number, reuse: string) {
		update((state) => {
			const { boundaries, elements } = state.answers;
			const memberOf = { ...boundaries.memberOf };
			const answerRef = `answer:${key}`;
			const existingRef = `existing:${reuse}`;
			const assignment = memberOf[answerRef];
			if (reuse && assignment !== undefined) {
				memberOf[existingRef] ??= assignment;
				delete memberOf[answerRef];
			}
			return {
				...state,
				answers: {
					...state.answers,
					elements: elements.map((element) =>
						element.key === key ? { ...element, reuse } : element,
					),
					boundaries: { ...boundaries, memberOf },
				},
			};
		});
	}

	const endpoints = interviewElements(model, answers);
	if (step === 0)
		return (
			<div className="grid gap-3">
				<Field label="What system are you modeling?">
					{(id) => (
						<Input
							id={id}
							value={answers.scope}
							onChange={(event) => edit("scope", () => event.target.value)}
						/>
					)}
				</Field>
				<Field label="Which assets need protection?">
					{(id) => (
						<Input
							id={id}
							value={answers.assets}
							onChange={(event) => edit("assets", () => event.target.value)}
						/>
					)}
				</Field>
			</div>
		);
	if (step === 1 || step === 2) {
		const stores = step === 2;
		const rows = answers.elements.filter(({ role }) => (role === "data_store") === stores);
		return (
			<div className="space-y-3">
				<p className="text-editor-body">
					{stores
						? "Where is data stored?"
						: "Who uses the system, and which services handle their requests?"}
				</p>
				{rows.map((row, index) => {
					const label = stores ? `Store ${index + 1}` : `Actor or service ${index + 1}`;
					const change = (patch: Partial<typeof row>) =>
						edit("elements", (items) =>
							items.map((item) => (item.key === row.key ? { ...item, ...patch } : item)),
						);
					return (
						<fieldset key={row.key} className="grid gap-2 border border-editor-line p-3">
							<legend className="px-1 text-editor-caption">{label}</legend>
							<Field label="Create or reuse">
								{(id) => (
									<NativeSelect
										id={id}
										value={row.reuse}
										onChange={(event) => changeReuse(row.key, event.target.value)}
									>
										<option value="">Create a new element</option>
										{model.elements.map(({ id, name }) => (
											<option key={id} value={id}>
												Reuse {name}
											</option>
										))}
									</NativeSelect>
								)}
							</Field>
							{!row.reuse && (
								<>
									<Field label={`${label} name`}>
										{(id) => (
											<Input
												id={id}
												value={row.name}
												onChange={(event) => change({ name: event.target.value })}
											/>
										)}
									</Field>
									{!stores && (
										<Field label="Role">
											{(id) => (
												<NativeSelect
													id={id}
													value={row.role}
													onChange={(event) =>
														change({
															role:
																event.target.value === "process" ? "process" : "external_entity",
														})
													}
												>
													<option value="external_entity">Actor</option>
													<option value="process">Service</option>
												</NativeSelect>
											)}
										</Field>
									)}
								</>
							)}
							<Button
								className="justify-self-start"
								variant="ghost"
								onClick={() => removeElement(row.key)}
							>
								Remove {label.toLowerCase()}
							</Button>
						</fieldset>
					);
				})}
				<Button
					variant="outline"
					onClick={() =>
						add("elements", {
							key: 0,
							name: "",
							reuse: "",
							role: stores ? "data_store" : "external_entity",
						})
					}
				>
					{stores ? "Add data store" : "Add actor or service"}
				</Button>
			</div>
		);
	}
	if (step === 3)
		return (
			<div className="space-y-3">
				<p className="text-editor-body">What data moves, and in which direction?</p>
				{answers.flows.map((row, index) => {
					const change = (patch: Partial<typeof row>) =>
						edit("flows", (items) =>
							items.map((item) => (item.key === row.key ? { ...item, ...patch } : item)),
						);
					return (
						<fieldset key={row.key} className="grid gap-2 border border-editor-line p-3">
							<legend className="px-1 text-editor-caption">Flow {index + 1}</legend>
							<Field label="Flow name">
								{(id) => (
									<Input
										id={id}
										value={row.name}
										onChange={(event) => change({ name: event.target.value })}
									/>
								)}
							</Field>
							{(["from", "to"] as const).map((end) => (
								<Field key={end} label={end === "from" ? "Source" : "Destination"}>
									{(id) => (
										<NativeSelect
											id={id}
											value={row[end]}
											onChange={(event) => change({ [end]: event.target.value })}
										>
											<option value="">Choose an element</option>
											{endpoints.map(({ ref, name }) => (
												<option key={ref} value={ref}>
													{name}
												</option>
											))}
										</NativeSelect>
									)}
								</Field>
							))}
							<Field label="Data carried (comma separated)">
								{(id) => (
									<Input
										id={id}
										value={row.data}
										onChange={(event) => change({ data: event.target.value })}
									/>
								)}
							</Field>
							<Button
								className="justify-self-start"
								variant="ghost"
								onClick={() => edit("flows", (items) => items.filter(({ key }) => key !== row.key))}
							>
								Remove flow {index + 1}
							</Button>
						</fieldset>
					);
				})}
				<Button
					variant="outline"
					onClick={() => add("flows", { key: 0, from: "", to: "", name: "", data: "" })}
				>
					Add flow
				</Button>
			</div>
		);
	if (step === 4) {
		const { definitions, memberOf } = answers.boundaries;
		const existingBoundaries = interviewExistingBoundaries(model);
		return (
			<div className="space-y-3">
				<p className="text-editor-body">
					Which elements share a trust boundary? Flows between members and non-members cross it.
				</p>
				{definitions.map((row, index) => {
					return (
						<fieldset key={row.key} className="grid gap-2 border border-editor-line p-3">
							<legend className="px-1 text-editor-caption">Boundary {index + 1}</legend>
							<Field label="Boundary name">
								{(id) => (
									<Input
										id={id}
										value={row.name}
										onChange={(event) => {
											const name = event.target.value;
											edit("boundaries", (current) => ({
												...current,
												definitions: current.definitions.map((item) =>
													item.key === row.key ? { ...item, name } : item,
												),
											}));
										}}
									/>
								)}
							</Field>
							<Button
								className="justify-self-start"
								variant="ghost"
								onClick={() =>
									edit("boundaries", (current) => ({
										definitions: current.definitions.filter(({ key }) => key !== row.key),
										memberOf: Object.fromEntries(
											Object.entries(current.memberOf).filter(([, key]) => key !== row.key),
										),
									}))
								}
							>
								Remove boundary {index + 1}
							</Button>
						</fieldset>
					);
				})}
				<Button
					variant="outline"
					onClick={() =>
						update((state) => ({
							...state,
							nextKey: state.nextKey + 1,
							answers: {
								...state.answers,
								boundaries: {
									...state.answers.boundaries,
									definitions: [
										...state.answers.boundaries.definitions,
										{ key: state.nextKey, name: "" },
									],
								},
							},
						}))
					}
				>
					Add boundary
				</Button>
				{definitions.length > 0 && (
					<fieldset className="grid gap-2 border border-editor-line p-3">
						<legend className="px-1 text-editor-caption">Boundary membership</legend>
						{endpoints.map(({ ref, name }) => {
							const owner = existingBoundaries.get(ref);
							if (owner !== undefined) {
								return (
									<p key={ref} className="text-editor-caption">
										{name} stays in {owner}.
									</p>
								);
							}
							return (
								<Field key={ref} label={`Boundary for ${name}`}>
									{(id) => (
										<NativeSelect
											id={id}
											value={memberOf[ref] ?? ""}
											onChange={(event) => {
												const value = event.target.value;
												edit("boundaries", (current) => {
													const memberOf = { ...current.memberOf };
													if (value) memberOf[ref] = Number(value);
													else delete memberOf[ref];
													return { ...current, memberOf };
												});
											}}
										>
											<option value="">No boundary</option>
											{definitions.map(({ key, name }, index) => (
												<option key={key} value={key}>
													{name.trim() || `Boundary ${index + 1}`}
												</option>
											))}
										</NativeSelect>
									)}
								</Field>
							);
						})}
					</fieldset>
				)}
			</div>
		);
	}
	return null;
}
