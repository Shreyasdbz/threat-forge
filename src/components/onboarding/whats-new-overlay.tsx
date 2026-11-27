import { Popover } from "@base-ui/react/popover";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CHANGELOG, markChangelogSeen, unseenChangelogEntries } from "@/lib/whats-new";

export function WhatsNewOverlay() {
	const [unseenEntries, setUnseenEntries] = useState(unseenChangelogEntries);
	const entries = unseenEntries.length > 0 ? unseenEntries : CHANGELOG.slice(0, 1);
	const [open, setOpen] = useState(false);

	return (
		<Popover.Root open={open} onOpenChange={setOpen}>
			<Popover.Trigger
				render={<Button type="button" variant="ghost" size="sm" />}
				className={unseenEntries.length ? "text-foreground" : "text-muted-foreground"}
			>
				What's New
			</Popover.Trigger>
			<Popover.Portal>
				<Popover.Positioner align="end" sideOffset={8} className="z-50">
					<Popover.Popup
						data-testid="whats-new-overlay"
						className="max-h-[min(70dvh,var(--available-height))] w-[min(24rem,var(--available-width))] overflow-y-auto rounded-editor-dialog border border-editor-separator bg-editor-raised p-4 shadow-editor-popover"
					>
						<Popover.Title className="mb-1 text-lg font-semibold text-foreground">
							What's New
						</Popover.Title>
						<p className="mb-4 text-editor-caption text-muted-foreground">
							Recent updates to Threat Forge
						</p>

						{entries.map((entry) => (
							<div key={entry.version} className="mb-4">
								<div className="mb-2 flex items-baseline gap-2">
									<span className="text-editor-footnote text-foreground">v{entry.version}</span>
									<span className="text-editor-caption text-muted-foreground">{entry.date}</span>
								</div>
								<ul className="space-y-1">
									{entry.changes.map((change) => (
										<li key={change} className="flex gap-2 text-editor-caption text-foreground/80">
											<span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-primary" />
											{change}
										</li>
									))}
								</ul>
							</div>
						))}

						<Button
							type="button"
							onClick={() => {
								setOpen(false);
								setUnseenEntries([]);
								markChangelogSeen();
							}}
						>
							Got it
						</Button>
					</Popover.Popup>
				</Popover.Positioner>
			</Popover.Portal>
		</Popover.Root>
	);
}
