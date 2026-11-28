import { Download, FileCode, Globe } from "lucide-react";
import { Link } from "react-router-dom";
import { PageShell } from "./shared/page-shell";

const FEATURES = [
	{
		title: "Review threats with STRIDE",
		description:
			"Check components and data flows against all six categories, then record mitigations.",
	},
	{
		title: "Keep the model in version control",
		description:
			"Open the .thf YAML file in a text editor or review the changes in a pull request.",
	},
	{
		title: "Review AI edits before applying",
		description:
			"Bring your own key to propose changes to elements, flows, and threats. Review the validated changes before applying them.",
	},
	{
		title: "Open the same file on desktop or web",
		description: "Use the browser editor or install Threat Forge on macOS, Windows, or Linux.",
	},
] as const;

const YAML_SAMPLE = `# ThreatForge Threat Model
version: "1.0"
metadata:
  title: "Payment Processing Service"
  author: "Alex Chen"

elements:
  - id: web-app
    type: process
    name: "Web Application"
    trust_zone: internal

  - id: api-gateway
    type: process
    name: "API Gateway"
    trust_zone: dmz

data_flows:
  - id: flow-1
    from: web-app
    to: api-gateway
    protocol: HTTPS/TLS-1.3
    authenticated: true

threats:
  - id: threat-1
    title: "SQL Injection on payment queries"
    category: Tampering
    element: api-gateway
    severity: High
    mitigation:
      status: mitigated
      description: "Parameterized queries via ORM"`;

export function LandingPage() {
	return (
		<PageShell title="Threat Forge — Open-Source AI Threat Modeling">
			<HeroSection />
			<FeaturesSection />
			<YamlShowcaseSection />
			<CtaSection />
		</PageShell>
	);
}

function HeroSection() {
	return (
		<section className="px-6 py-12 md:py-20" data-testid="hero">
			<div className="mx-auto grid max-w-6xl items-center gap-8 lg:grid-cols-2">
				<div>
					<h1 className="max-w-lg text-[2rem]/10 font-semibold tracking-tight text-balance sm:text-[2.25rem]/11">
						Draw your architecture. Review its threats.
					</h1>
					<p className="mt-4 max-w-md text-sm/6 text-muted-foreground">
						Connect components, run STRIDE, and save the architecture as a portable .thf file. No
						account required.
					</p>
					<div className="mt-6 flex flex-wrap gap-2">
						<Link
							to="/app"
							className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-tf-signal px-6 py-3 text-sm font-medium text-tf-zero transition-opacity hover:opacity-90 sm:w-auto"
						>
							<Globe className="h-4 w-4" />
							Try it in the browser
						</Link>
						<Link
							to="/downloads"
							className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-border px-6 py-3 text-sm font-medium text-foreground transition-colors hover:bg-secondary sm:w-auto"
						>
							<Download className="h-4 w-4" />
							Download
						</Link>
					</div>
				</div>
				<CloudServicePreview />
			</div>
		</section>
	);
}

function CloudServicePreview() {
	return (
		<figure className="border border-border bg-card text-card-foreground">
			<figcaption className="border-b border-border px-4 py-3 text-sm font-semibold">
				Cloud Service{" "}
				<span className="ml-2 text-xs font-medium text-muted-foreground">Architecture starter</span>
			</figcaption>
			<img
				src="/cloud-service-preview.svg"
				width={1036}
				height={484}
				className="block h-auto w-full bg-white"
				alt="Orders Browser sends requests to the Orders API, which reads and writes orders in the Orders Database."
			/>
			<p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
				In the editor: open Cloud Service, then select Threats → Run STRIDE Analysis.
			</p>
		</figure>
	);
}

function FeaturesSection() {
	return (
		<section className="border-t border-border/50 px-6 py-12">
			<div className="mx-auto max-w-6xl">
				<h2 className="text-xl font-semibold tracking-tight text-foreground">
					From diagram to review
				</h2>
				<ul className="mt-4 divide-y divide-border">
					{FEATURES.map((feature) => (
						<li key={feature.title} className="grid gap-1 py-3 sm:grid-cols-[16rem_1fr] sm:gap-4">
							<h3 className="text-sm font-semibold text-foreground">{feature.title}</h3>
							<p className="text-sm leading-relaxed text-muted-foreground">{feature.description}</p>
						</li>
					))}
				</ul>
			</div>
		</section>
	);
}

function YamlShowcaseSection() {
	return (
		<section className="border-t border-border/50 px-6 py-20">
			<div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-2 lg:items-center">
				<div>
					<h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
						Yes, it&apos;s just a file
					</h2>
					<p className="mt-4 text-muted-foreground leading-relaxed">
						Everything lives in one{" "}
						<code className="rounded bg-secondary px-1.5 py-0.5 font-mono text-sm text-foreground">
							.thf
						</code>{" "}
						file. Someone widens a trust boundary, and the diff is one line — reviewable by a
						teammate who has never opened Threat Forge and has no intention of starting.
					</p>
					<ul className="mt-6 space-y-3">
						{[
							"Readable in any editor, including the one you're already in",
							"One file — no sidecars, no lockfile, no project folder",
							"Diffs a person can actually review",
							"Schema-validated, so other tools can read it too",
						].map((item) => (
							<li key={item} className="flex items-start gap-2 text-sm text-muted-foreground">
								<span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-tf-signal" />
								{item}
							</li>
						))}
					</ul>
				</div>
				<div className="overflow-hidden rounded-lg border border-border/50 bg-card">
					<div className="flex items-center gap-2 border-b border-border/50 bg-secondary/30 px-4 py-2.5">
						<FileCode className="h-4 w-4 text-muted-foreground" />
						<span className="font-mono text-xs text-muted-foreground">payment-service.thf</span>
					</div>
					{/*
					 * Below about 440px this sample scrolls sideways — `white-space: pre` is the point of
					 * showing a file, so it cannot reflow, and without a tab stop a keyboard user cannot
					 * read the right-hand half of any line (WCAG 2.1.1, #249).
					 *
					 * The `<section>` exists to carry the label: `<pre>` maps to `generic`, which supports no
					 * accessible name at all. `w-max` on the `<pre>` stops a block child from shrinking to
					 * the scroller. The ring is inset because the card wrapping this is `overflow-hidden`
					 * and would clip an outset one.
					 *
					 * No `onKeyDown` guard here, unlike the component palette this borrows from. That guard
					 * exists to keep arrow keys away from the canvas shortcuts, and those mount in
					 * `app-layout`, which the marketing routes never render.
					 */}
					<section
						aria-label="Example threat model file"
						className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
						// biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be focusable for keyboard access
						tabIndex={0}
					>
						<pre className="w-max p-4 font-mono text-xs leading-relaxed text-muted-foreground">
							<code>{YAML_SAMPLE}</code>
						</pre>
					</section>
				</div>
			</div>
		</section>
	);
}

function CtaSection() {
	return (
		<section className="border-t border-border/50 px-6 py-24 text-center">
			<div className="mx-auto max-w-2xl">
				<h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
					Open the editor
				</h2>
				<p className="mt-4 text-muted-foreground">
					Free and open source. Your models stay on your machine unless you connect an AI provider.
				</p>
				<div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
					<Link
						to="/app"
						className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-tf-signal px-6 py-3 text-sm font-medium text-tf-zero transition-opacity hover:opacity-90 sm:w-auto"
					>
						<Globe className="h-4 w-4" />
						Try it in the browser
					</Link>
					<Link
						to="/downloads"
						className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-border px-6 py-3 text-sm font-medium text-foreground transition-colors hover:bg-secondary sm:w-auto"
					>
						<Download className="h-4 w-4" />
						Download
					</Link>
				</div>
			</div>
		</section>
	);
}
