import { createStore } from "zustand/vanilla";
import type { InterviewAnswers } from "@/lib/interview-proposal";

export interface InterviewDraft {
	step: number;
	nextKey: number;
	answers: InterviewAnswers;
}

interface InterviewState {
	draft: InterviewDraft | null;
	visible: boolean;
	start: () => void;
	hide: () => void;
	update: (update: (draft: InterviewDraft) => InterviewDraft) => void;
	discard: () => void;
}

export function createInterviewStore() {
	return createStore<InterviewState>((set) => ({
		draft: null,
		visible: false,
		start: () =>
			set((state) =>
				state.draft
					? { visible: true }
					: {
							visible: true,
							draft: {
								step: 0,
								nextKey: 1,
								answers: { scope: "", assets: "", elements: [], flows: [], boundaries: [] },
							},
						},
			),
		update: (update) => set((state) => (state.draft ? { draft: update(state.draft) } : state)),
		hide: () => set({ visible: false }),
		discard: () => set({ draft: null, visible: false }),
	}));
}
