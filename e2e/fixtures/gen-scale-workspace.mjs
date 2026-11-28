import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { dump, load } from "js-yaml";

export const scaleSizes = [1000, 2500, 5000];
export const topologies = ["grid", "sparse", "clustered", "fanout", "disconnected"];
export const scaleSeed = 396;

const starter = new URL("../../src/lib/architecture-starters/cloud-service.thf", import.meta.url);
const scalars = ["00123", "+0o10", "yes", "true", "null", "配送", "طلب", "Order, email", "12:30"];

/** @param {unknown} value */
export function digest(value) {
	return createHash("sha256").update(JSON.stringify(value, orderKeys)).digest("hex");
}

/** @param {string} _key @param {unknown} value */
function orderKeys(_key, value) {
	return value && typeof value === "object" && !Array.isArray(value)
		? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
		: value;
}

/** @param {number} index */
const id = (index) => `bulk-${String(index).padStart(4, "0")}`;

/** @param {import("../../src/types/threat-model").ThreatModel} model */
export function layoutDigest(model) {
	return digest(model.elements.map(({ id, position }) => [id, position]));
}

/** @param {number} size @param {string} topology @param {number} [seed] */
export function scaleFixture(size, topology, seed = scaleSeed) {
	if (!scaleSizes.includes(size) || !topologies.includes(topology)) {
		throw new Error(`Invalid scale fixture: ${size} ${topology}`);
	}
	if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
		throw new Error(`Invalid scale seed: ${seed}`);
	}
	const base = /** @type {import("../../src/types/threat-model").ThreatModel} */ (
		load(readFileSync(starter, "utf8"))
	);
	let state = seed;
	const next = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0);
	const count = size - base.elements.length;
	const columns = Math.ceil(Math.sqrt(count));
	const elements = base.elements.concat(
		Array.from({ length: count }, (_, index) => ({
			id: id(index),
			name: `Service ${index}`,
			type: "generic",
			trust_zone: "internal",
			description: scalars[next() % scalars.length],
			technologies: [],
			position: {
				x: 1024 + (index % columns) * 230 + (next() % 5),
				y: Math.floor(index / columns) * 140,
			},
		})),
	);
	const dataFlows = [...base.data_flows];
	for (let to = 1; to < count; to++) {
		if (
			topology === "disconnected" ||
			(topology === "sparse" && to % 4 !== 0) ||
			(topology === "clustered" && to % 12 === 0)
		) {
			continue;
		}
		const from = topology === "fanout" ? 0 : topology === "sparse" ? next() % to : to - 1;
		dataFlows.push({
			id: `bulk-flow-${to}`,
			from: id(from),
			to: id(to),
			name: `Request ${to}`,
			protocol: "HTTPS",
			data: [scalars[next() % scalars.length]],
			authenticated: true,
		});
	}
	const model = {
		...base,
		version: "1.1",
		metadata: { ...base.metadata, title: `Scale ${size} ${topology} ${seed}` },
		elements,
		data_flows: dataFlows,
		diagrams: [
			...base.diagrams,
			{
				id: "order-sequence",
				name: "Load orders",
				kind: "sequence",
				sequence: {
					participants: [
						{ id: "client", element_id: "entrypoint" },
						{ id: "api", element_id: "processor" },
					],
					messages: [
						{ id: "load", from: "client", to: "api", label: "Load storefront", flow_id: "request" },
					],
				},
			},
		],
	};
	return {
		model,
		thf: dump(model, { lineWidth: -1, noRefs: true, forceQuotes: true }),
		fingerprint: {
			version: 1,
			size,
			topology,
			seed,
			elements: elements.length,
			flows: dataFlows.length,
			topologyDigest: digest(dataFlows.map(({ from, to }) => [from, to])),
			layoutDigest: layoutDigest(model),
		},
	};
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
	const [, , size = "1000", topology = "sparse", seed = String(scaleSeed)] = process.argv;
	const { thf, fingerprint } = scaleFixture(Number(size), topology, Number(seed));
	console.error(JSON.stringify(fingerprint));
	process.stdout.write(thf);
}
