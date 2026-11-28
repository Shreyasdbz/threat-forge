import { createStore } from "zustand/vanilla";
import type { InterviewAnswers } from "@/lib/interview-proposal";
import type { InterviewReview } from "@/lib/interview-review";

export interface InterviewDraft {
	step: number;
	nextKey: number;
	answers: InterviewAnswers;
	review: InterviewReview | null;
}

interface InterviewState {
	draft: InterviewDraft | null;
	visible: boolean;
	applied: boolean;
	start: () => void;
	hide: () => void;
	complete: () => void;
	update: (update: (draft: InterviewDraft) => InterviewDraft) => void;
	discard: () => void;
}

export function createInterviewStore() {
	return createStore<InterviewState>((set) => ({
		draft: null,
		visible: false,
		applied: false,
		start: () =>
			set((state) =>
				state.draft || state.applied
					? { visible: true }
					: {
							visible: true,
							draft: {
								step: 0,
								nextKey: 1,
								answers: { scope: "", assets: "", elements: [], flows: [], boundaries: [] },
								review: null,
							},
						},
			),
		update: (update) => set((state) => (state.draft ? { draft: update(state.draft) } : state)),
		hide: () => set({ visible: false }),
		complete: () => set({ draft: null, visible: true, applied: true }),
		discard: () => set({ draft: null, visible: false, applied: false }),
	}));
}
