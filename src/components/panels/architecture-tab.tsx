import { Layers3, Plus } from "lucide-react";
import { useId, useState } from "react";
import { useModelStore } from "@/stores/model-store";
import { useUiStore } from "@/stores/ui-store";
import type { Element, Group, Layer } from "@/types/threat-model";

export function ArchitectureTab() {
	const model = useModelStore((state) => state.model);
	const selectElement = useModelStore((state) => state.setSelectedElement);
	const setTab = useUiStore((state) => state.setRightPanelTab);

	if (!model) return <p className="text-xs text-muted-foreground">No model open.</p>;

	function inspect(id: string) {
		selectElement(id);
		setTab("properties");
	}

	return (
		<div className="space-y-5">
			<div className="rounded-lg border border-border bg-muted/40 p-3">
				<h2 className="flex items-center gap-2 text-sm font-semibold">
					<Layers3 className="size-4 text-primary" aria-hidden="true" /> Architecture
				</h2>
				<p className="mt-1 text-xs leading-relaxed text-muted-foreground">
					Layers describe system tiers. Groups organize related components independently of trust
					boundaries.
				</p>
			</div>
			<Section
				kind="layers"
				sections={model.layers ?? []}
				elements={model.elements}
				onInspect={inspect}
			/>
			<Section
				kind="groups"
				sections={model.groups ?? []}
				elements={model.elements}
				onInspect={inspect}
			/>
		</div>
	);
}

function Section({
	kind,
	sections,
	elements,
	onInspect,
}: {
	kind: "layers" | "groups";
	sections: (Layer | Group)[];
	elements: Element[];
	onInspect: (id: string) => void;
}) {
	const inputId = useId();
	const [name, setName] = useState("");
	const addSection = useModelStore((state) => state.addArchitectureSection);
	const heading = kind === "layers" ? "Layers" : "Groups";
	const singular = kind === "layers" ? "layer" : "group";
	const field = kind === "layers" ? "layer" : "group";
	const names = new Map(sections.map((section) => [section.id, section.name]));
	const membership = new Map<string, Element[]>();
	for (const element of elements) {
		const key = element[field];
		if (!key) continue;
		const members = membership.get(key);
		if (members) members.push(element);
		else membership.set(key, [element]);
	}

	return (
		<section aria-label={heading} className="space-y-2">
			<h3 className="flex items-center justify-between text-xs font-semibold">
				{heading}
				<span className="text-muted-foreground tabular-nums">{sections.length}</span>
			</h3>
			{sections.length === 0 && <p className="text-xs text-muted-foreground">No {kind} yet.</p>}
			{sections.map((section) => {
				const members = membership.get(section.id) ?? [];
				const parent = "parent" in section && section.parent ? names.get(section.parent) : null;
				return (
					<article
						key={section.id}
						aria-label={section.name}
						className="rounded-md border border-border px-2.5 py-2"
					>
						<h4 className="break-words text-xs font-medium">{section.name}</h4>
						{parent && <p className="text-xs text-muted-foreground">Inside {parent}</p>}
						{section.description && (
							<p className="mt-1 text-xs text-muted-foreground">{section.description}</p>
						)}
						{members.length > 0 ? (
							<ul className="mt-1 space-y-0.5">
								{members.map((element) => (
									<li key={element.id}>
										<button
											type="button"
											className="w-full truncate rounded px-1 py-0.5 text-left text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
											onClick={() => onInspect(element.id)}
										>
											{element.name}
										</button>
									</li>
								))}
							</ul>
						) : (
							<p className="mt-1 text-xs text-muted-foreground">No components assigned</p>
						)}
					</article>
				);
			})}
			<form
				className="flex gap-1.5"
				onSubmit={(event) => {
					event.preventDefault();
					addSection(kind, name);
					setName("");
				}}
			>
				<label htmlFor={inputId} className="sr-only">
					New {singular} name
				</label>
				<input
					id={inputId}
					value={name}
					onChange={(event) => setName(event.target.value)}
					placeholder={`New ${singular} name`}
					className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-xs"
				/>
				<button
					type="submit"
					aria-label={`Add ${singular}`}
					disabled={!name.trim()}
					className="rounded border border-border p-1.5 hover:bg-accent disabled:opacity-50"
				>
					<Plus aria-hidden="true" className="size-4" />
				</button>
			</form>
		</section>
	);
}
