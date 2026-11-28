import { RotateCcw } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useId, useLayoutEffect, useState } from "react";
import { useActiveStores } from "@/stores/document-stores";

export const ROW =
	"grid min-h-editor-row grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-center gap-2 py-1 [&_select]:rounded-editor-control [&_select]:border-0 [&_select]:pl-2 [&_select]:text-editor-body";
export const LABEL = "text-editor-footnote text-editor-secondary-label";
export const INPUT =
	"min-h-editor-icon w-full min-w-0 rounded-editor-control border-0 bg-transparent px-2 py-1 text-left text-editor-body text-foreground placeholder:text-editor-secondary-label hover:bg-editor-hover focus:bg-editor-fill";

export function InspectorGroup({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section>
			<h3 className="text-editor-headline">{title}</h3>
			{children}
		</section>
	);
}

export function InspectorField({ label, children }: { label: string; children: ReactNode }) {
	return (
		// biome-ignore lint/a11y/noLabelWithoutControl: each caller passes its form control as the label child
		<label className={ROW}>
			<span className={LABEL}>{label}</span>
			{children}
		</label>
	);
}

export function ColorField({
	label,
	color,
	opacity,
	onColorChange,
	onOpacityChange,
}: {
	label: string;
	color: unknown;
	opacity: number;
	onColorChange: (color: string) => void;
	onOpacityChange: (opacity: number) => void;
}) {
	const hasStoredColor = color != null;
	const hex =
		typeof color === "string" ? color.match(/^#([\da-f]{3}|[\da-f]{6})$/i)?.[1] : undefined;
	const swatchColor =
		hex?.length === 3
			? `#${[...hex].map((digit) => digit.repeat(2)).join("")}`
			: hex
				? `#${hex}`
				: undefined;
	const description = swatchColor
		? undefined
		: hasStoredColor
			? "Color preview unavailable"
			: "Default color";
	return (
		<div className={ROW}>
			<span className={LABEL}>{label}</span>
			<div className="flex min-w-0 flex-wrap items-center gap-1">
				<span className="relative grid size-7 shrink-0 place-items-center rounded-editor-control hover:bg-editor-hover has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-editor-accent">
					<span
						aria-hidden="true"
						style={{ backgroundColor: swatchColor }}
						className={`size-5 rounded-sm border border-editor-outline ${hasStoredColor ? "bg-editor-fill" : "bg-linear-to-br from-transparent from-45% via-editor-secondary-label via-50% to-transparent to-55%"}`}
					/>
					<input
						type="color"
						aria-label={label}
						aria-description={description}
						title={swatchColor ?? description}
						value={swatchColor ?? "#888888"}
						onChange={(e) => onColorChange(e.target.value)}
						className="absolute inset-0 size-full cursor-pointer opacity-0"
					/>
				</span>
				<label className="flex shrink-0 items-center rounded-editor-control pr-1 text-editor-caption text-editor-secondary-label hover:bg-editor-hover focus-within:bg-editor-fill">
					<input
						type="number"
						aria-label={`${label} opacity (%)`}
						min={0}
						max={100}
						step={5}
						value={Math.round(opacity * 100)}
						onChange={(e) => {
							if (Number.isFinite(e.target.valueAsNumber)) {
								onOpacityChange(Math.max(0, Math.min(100, e.target.valueAsNumber)) / 100);
							}
						}}
						className="h-7 w-10 appearance-none rounded-editor-control bg-transparent pl-1 text-right text-foreground tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
					/>
					%
				</label>
				{hasStoredColor ? (
					<button
						type="button"
						onClick={() => onColorChange("")}
						aria-label={`Reset ${label.toLowerCase()} to default`}
						title="Reset to default"
						className="grid size-7 place-items-center rounded-editor-control text-muted-foreground hover:bg-editor-hover"
					>
						<RotateCcw className="size-4" aria-hidden="true" />
					</button>
				) : null}
			</div>
		</div>
	);
}

export function ReadOnlyField({ label, value }: { label: string; value: string }) {
	return (
		<dl className={ROW}>
			<dt className={LABEL}>{label}</dt>
			<dd
				className={`min-w-0 wrap-anywhere px-2 text-left ${
					label === "ID" ? "break-all font-editor-mono text-editor-caption" : "text-editor-body"
				}`}
			>
				{value}
			</dd>
		</dl>
	);
}

export function EditableField({
	label,
	value,
	placeholder,
	onChange,
}: {
	label: string;
	value: string;
	placeholder?: string;
	onChange: (value: string) => void;
}) {
	return (
		<InspectorField label={label}>
			<input
				type="text"
				value={value}
				placeholder={placeholder}
				onChange={(e) => onChange(e.target.value)}
				className={INPUT}
			/>
		</InspectorField>
	);
}

export function EditableTextarea({
	label,
	value,
	placeholder,
	onChange,
}: {
	label: string;
	value: string;
	placeholder?: string;
	onChange: (value: string) => void;
}) {
	return (
		<label className="grid gap-1 py-2">
			<span className={LABEL}>{label}</span>
			<textarea
				value={value}
				placeholder={placeholder}
				onChange={(e) => onChange(e.target.value)}
				rows={3}
				className={`${INPUT} resize-none`}
			/>
		</label>
	);
}

/**
 * A text input that accepts comma-separated values but only parses them on blur,
 * allowing the user to type commas freely without the input fighting them.
 */
export function CommaSeparatedField({
	label,
	items,
	placeholder,
	onCommit,
}: {
	label: string;
	items: string[];
	placeholder?: string;
	onCommit: (items: string[]) => void;
}) {
	const [rawText, setRawText] = useState(items.join(", "));
	const [isFocused, setIsFocused] = useState(false);
	const { pendingDrafts } = useActiveStores();
	const draftId = useId();

	useLayoutEffect(
		() => () => {
			pendingDrafts.delete(draftId);
		},
		[draftId, pendingDrafts],
	);

	// Sync from external changes only when not focused
	useEffect(() => {
		if (!isFocused) {
			setRawText(items.join(", "));
		}
	}, [items, isFocused]);

	const commitValue = useCallback(() => {
		if (!pendingDrafts.delete(draftId)) return;
		const parsed = rawText
			.split(",")
			.map((s) => s.trim())
			.filter((s) => s.length > 0);
		onCommit(parsed);
	}, [draftId, pendingDrafts, rawText, onCommit]);

	return (
		<InspectorField label={label}>
			<input
				type="text"
				value={rawText}
				placeholder={placeholder}
				onChange={(e) => {
					const value = e.target.value;
					if (value === items.join(", ")) pendingDrafts.delete(draftId);
					else pendingDrafts.add(draftId);
					setRawText(value);
				}}
				onFocus={() => setIsFocused(true)}
				onBlur={() => {
					setIsFocused(false);
					commitValue();
				}}
				onKeyDown={(e) => {
					if (e.key === "Enter") commitValue();
				}}
				className={INPUT}
			/>
		</InspectorField>
	);
}
