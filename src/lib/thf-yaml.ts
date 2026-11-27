import {
	binaryTag,
	CORE_SCHEMA,
	type DumpOptions,
	defineScalarTag,
	dump,
	floatCoreTag,
	intCoreTag,
	load,
	mergeTag,
	NOT_RESOLVED,
	omapTag,
	pairsTag,
	Schema,
	setTag,
	YAML11_SCHEMA,
} from "js-yaml";
import type { Threat, ThreatModel } from "@/types/threat-model";

/** The YAML 1.1 type that resolves an unquoted `2026-03-15` scalar to a JavaScript `Date`. */
const TIMESTAMP_TAG = "tag:yaml.org,2002:timestamp";

/** Sections a `.thf` document may omit when they hold nothing. */
const COLLECTION_SECTIONS = [
	"elements",
	"data_flows",
	"trust_boundaries",
	"threats",
	"diagrams",
] as const;

/** `metadata.created` and `metadata.modified` as the schema defines them: a calendar date. */
const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A calendar date followed by a time of day, e.g. `2026-03-15T00:00:00.000Z`. */
const DATE_WITH_TIME = /^(\d{4}-\d{2}-\d{2})[T ]/;

const LEADING_ZERO_INTEGER = /^[+-]?0[0-9]+$/;
const thfIntegerTag = {
	...intCoreTag,
	resolve(source: string, _isExplicit: boolean, tagName: string) {
		if (LEADING_ZERO_INTEGER.test(source)) return NOT_RESOLVED;
		return intCoreTag.resolve(source, true, tagName);
	},
};
const thfFloatTag = {
	...floatCoreTag,
	resolve(source: string, isExplicit: boolean, tagName: string) {
		if (!isExplicit && LEADING_ZERO_INTEGER.test(source)) return NOT_RESOLVED;
		return floatCoreTag.resolve(source, isExplicit, tagName);
	},
};

const legacyScalarTags = YAML11_SCHEMA.implicitScalarTags.filter(
	(tag) => tag.tagName !== TIMESTAMP_TAG,
);
const legacyTextTag = defineScalarTag("tag:threatforge.dev,2026:legacy-text", {
	implicit: true,
	resolve(source, isExplicit) {
		return !isExplicit &&
			legacyScalarTags.some((tag) => tag.resolve(source, false, tag.tagName) !== NOT_RESOLVED)
			? source
			: NOT_RESOLVED;
	},
});

/**
 * One schema for reading and writing. The numeric resolvers match serde_yaml's handling of
 * base-prefixed integers and leading-zero decimal strings. The last resolver keeps YAML 1.1
 * ambiguities such as bare `y` and `on` as text on read while making the dumper quote them.
 * Timestamps stay plain strings so desktop calendar dates round-trip.
 */
export const THF_YAML_SCHEMA = new Schema([
	...CORE_SCHEMA.tags,
	thfIntegerTag,
	thfFloatTag,
	mergeTag,
	binaryTag,
	omapTag,
	pairsTag,
	setTag,
	legacyTextTag,
]);

/** Options the browser writer passes to `dump` for every `.thf` document. */
export const THF_YAML_DUMP_OPTIONS: DumpOptions = {
	lineWidth: -1,
	noRefs: true,
	sortKeys: false,
	quoteStyle: "double",
	schema: THF_YAML_SCHEMA,
};

/**
 * Parse `.thf` text into a `ThreatModel`.
 *
 * Verified here: the document and its `metadata` are mappings, `metadata.created` and
 * `metadata.modified` are plain `YYYY-MM-DD` strings, and each collection section is a sequence
 * when present. Schema version, duplicate IDs, dangling references, and per-entity field shapes
 * are *not* verified — the browser read path still accepts documents the desktop rejects (#116).
 *
 * Throws an `Error` whose message is safe to show the user.
 */
export function parseThreatModelYaml(text: string): ThreatModel {
	const parsed = load(text, { schema: THF_YAML_SCHEMA });
	assertThreatModelShape(parsed);
	parsed.metadata.description ??= "";

	// A `.thf` omits empty collections; materialize them so callers never see an absent array.
	parsed.elements ??= [];
	parsed.data_flows ??= [];
	parsed.trust_boundaries ??= [];
	parsed.threats ??= [];
	parsed.diagrams ??= [];

	for (const element of parsed.elements) {
		element.technologies ??= [];
	}

	return parsed;
}

/** Serialize a `ThreatModel` to `.thf` text the desktop reader accepts. */
export function serializeThreatModelYaml(model: ThreatModel): string {
	return dump(model, THF_YAML_DUMP_OPTIONS);
}

/**
 * Serialize a single `Threat` as a one-item `.thf` YAML sequence — the same shape it takes
 * inside a document's `threats:` section, ready to paste into an issue, PR, or doc. Reuses the
 * document dump options so escaping, enum casing, and nested `mitigation` match the canonical
 * writer exactly rather than a hand-built subset.
 */
export function serializeThreatYaml(threat: Threat): string {
	return dump([threat], THF_YAML_DUMP_OPTIONS);
}

function assertThreatModelShape(value: unknown): asserts value is ThreatModel {
	const document = requireMapping(value, "This file is not a ThreatForge threat model.");
	const metadata = requireMapping(
		document.metadata,
		"This file cannot be opened: it has no metadata section.",
	);

	requireCalendarDate(metadata, "created");
	requireCalendarDate(metadata, "modified");
	if (metadata.description != null && typeof metadata.description !== "string") {
		throw new Error("This file cannot be opened: metadata.description must be text.");
	}

	for (const section of COLLECTION_SECTIONS) {
		const entries = document[section];
		if (entries !== undefined && entries !== null && !Array.isArray(entries)) {
			throw new Error(`This file cannot be opened: ${section} is not a list of entries.`);
		}
	}
}

function requireMapping(value: unknown, message: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(message);
	}
	return value as Record<string, unknown>;
}

function requireCalendarDate(metadata: Record<string, unknown>, key: "created" | "modified"): void {
	const value = metadata[key];
	if (typeof value === "string" && CALENDAR_DATE.test(value)) return;

	const field = `metadata.${key}`;

	if (typeof value === "string") {
		const withTime = DATE_WITH_TIME.exec(value);
		if (withTime) {
			throw new Error(
				`This file cannot be opened: ${field} is ${quoteUntrusted(value)}, which carries a ` +
					`time of day. ThreatForge records plain calendar dates, and the desktop app rejects ` +
					`this value. Older ThreatForge web builds wrote it: change the line to read ` +
					`"${key}: ${withTime[1]}" and open the file again.`,
			);
		}
	}

	if (value === undefined || value === null) {
		throw new Error(
			`This file cannot be opened: ${field} is missing. Every threat model records a ${key} ` +
				`date in YYYY-MM-DD form.`,
		);
	}

	throw new Error(
		`This file cannot be opened: ${field} must be a calendar date in YYYY-MM-DD form` +
			`${typeof value === "string" ? `, not ${quoteUntrusted(value)}` : ""}.`,
	);
}

/** Quote a value read from an untrusted file, bounded so one long scalar cannot flood a dialog. */
function quoteUntrusted(value: string): string {
	return value.length > 40 ? `"${value.slice(0, 40)}…"` : `"${value}"`;
}
