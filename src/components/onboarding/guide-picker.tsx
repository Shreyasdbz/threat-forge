import { Dialog } from "@base-ui/react/dialog";
import { BookOpen, Check, X } from "lucide-react";
import { ALL_GUIDES } from "@/lib/onboarding/guides";
import { useOnboardingStore } from "@/stores/onboarding-store";

/**
 * Dialog listing all available guides. Users can start any guide or re-run completed ones.
 */
export function GuidePicker({ onClose }: { onClose: () => void }) {
	const completedGuideIds = useOnboardingStore((s) => s.completedGuideIds);
	const startGuide = useOnboardingStore((s) => s.startGuide);
	const resetGuide = useOnboardingStore((s) => s.resetGuide);

	const handleStart = (guideId: string) => {
		const isCompleted = completedGuideIds.includes(guideId);
		if (isCompleted) {
			resetGuide(guideId);
		}
		startGuide(guideId);
		onClose();
	};

	return (
		<Dialog.Portal>
			<Dialog.Backdrop className="fixed inset-0 z-[9997] bg-black/50" />
			<Dialog.Popup
				data-testid="guide-picker"
				aria-modal="true"
				className="fixed top-1/2 left-1/2 z-[9998] max-h-[calc(100dvh-2rem)] w-[min(20rem,calc(100%-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-editor-dialog border border-editor-separator bg-editor-raised p-4 shadow-editor-dialog"
			>
				<div className="mb-3 flex items-center justify-between">
					<Dialog.Title className="text-editor-headline text-foreground">Guided Tours</Dialog.Title>
					<Dialog.Close
						aria-label="Close guided tours"
						className="grid size-7 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
					>
						<X className="h-4 w-4" aria-hidden="true" />
					</Dialog.Close>
				</div>

				<div className="space-y-2">
					{ALL_GUIDES.map((guide) => {
						const isCompleted = completedGuideIds.includes(guide.id);
						return (
							<button
								key={guide.id}
								type="button"
								onClick={() => handleStart(guide.id)}
								className="flex w-full items-center gap-3 rounded-md p-2 text-left hover:bg-accent"
							>
								<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
									{isCompleted ? <Check className="h-4 w-4" /> : <BookOpen className="h-4 w-4" />}
								</div>
								<div className="min-w-0">
									<div className="text-editor-footnote text-foreground">{guide.name}</div>
									<div className="text-editor-caption text-muted-foreground">
										{guide.steps.length} steps
										{isCompleted && " — completed"}
									</div>
								</div>
							</button>
						);
					})}
				</div>
			</Dialog.Popup>
		</Dialog.Portal>
	);
}
