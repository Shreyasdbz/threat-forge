import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { getDefaultModelId } from "@/lib/ai-models";
import { INTERVIEW_ANSWER_SECTIONS, requestInterviewQuestions } from "@/lib/interview-assistance";
import type { InterviewAnswers } from "@/lib/interview-proposal";
import { useChatStore } from "@/stores/chat-store";
import { useSettingsStore } from "@/stores/settings-store";

const SECTIONS = Object.keys(INTERVIEW_ANSWER_SECTIONS) as (keyof InterviewAnswers)[];
const MESSAGES = {
	cancelled: "Request cancelled. You can continue offline.",
	"missing-key":
		"No API key is configured for this provider. You can continue offline or add one in Settings.",
	unavailable: "AI assistance is unavailable. You can continue offline.",
	invalid: "The provider did not return valid follow-up questions. You can continue offline.",
};

export function InterviewAssistance({
	answers,
	stillCurrent,
}: {
	answers: InterviewAnswers;
	stillCurrent: () => boolean;
}) {
	const provider = useChatStore((state) => state.provider);
	const providerName = provider === "openai" ? "OpenAI" : "Anthropic";
	const [open, setOpen] = useState(false);
	const [selected, setSelected] = useState<Set<keyof InterviewAnswers>>(new Set());
	const [questions, setQuestions] = useState<string[]>();
	const [pending, setPending] = useState(false);
	const [notice, setNotice] = useState<string>();
	const active = useRef<AbortController | null>(null);
	useEffect(
		() => () => {
			active.current?.abort();
			active.current = null;
		},
		[],
	);

	async function send() {
		if (active.current || !selected.size) return;
		if (!stillCurrent()) {
			setNotice("This draft is no longer current. Rebuild the proposal to request new questions.");
			return;
		}
		const controller = new AbortController();
		active.current = controller;
		setPending(true);
		setNotice(undefined);
		setQuestions(undefined);
		const settings = useSettingsStore.getState().settings;
		const modelId =
			(provider === "openai" ? settings.aiModelOpenai : settings.aiModelAnthropic) ||
			getDefaultModelId(provider);
		const result = await requestInterviewQuestions({
			provider,
			modelId,
			answers: Object.fromEntries([...selected].map((key) => [key, answers[key]])),
			signal: controller.signal,
		});
		if (active.current !== controller) return;
		active.current = null;
		setPending(false);
		if (!stillCurrent()) {
			setNotice("This draft is no longer current. Rebuild the proposal to request new questions.");
		} else if (result.status === "questions") {
			setQuestions(result.questions);
		} else {
			setNotice(MESSAGES[result.status]);
		}
	}

	if (!open)
		return (
			<Button variant="ghost" onClick={() => setOpen(true)}>
				Optional AI follow-up
			</Button>
		);
	return (
		<fieldset className="space-y-3 border border-editor-line p-3">
			<legend className="px-1 font-semibold">Optional AI follow-up</legend>
			<p>Choose which answers to send to {providerName}. Nothing is sent until you confirm.</p>
			{SECTIONS.map((key) => (
				<label key={key} className="flex items-center gap-2">
					<input
						type="checkbox"
						checked={selected.has(key)}
						disabled={pending || !answers[key].length}
						onChange={(event) => {
							const next = new Set(selected);
							if (event.target.checked) next.add(key);
							else next.delete(key);
							setSelected(next);
						}}
					/>
					{INTERVIEW_ANSWER_SECTIONS[key]}
				</label>
			))}
			<div className="flex flex-wrap gap-2">
				<Button variant="outline" disabled={pending || !selected.size} onClick={() => void send()}>
					Send selected answers to {providerName}
				</Button>
				{pending && (
					<Button
						variant="ghost"
						onClick={() => {
							active.current?.abort();
							active.current = null;
							setPending(false);
							setNotice(MESSAGES.cancelled);
						}}
					>
						Cancel AI request
					</Button>
				)}
			</div>
			{pending && <p role="status">Waiting for {providerName}…</p>}
			{notice && <p role="status">{notice}</p>}
			{questions && (
				<div className="space-y-2">
					<h4 className="font-semibold">Suggested follow-up questions</h4>
					{questions.length ? (
						<>
							<p>
								These suggestions do not change your model. Use Back to revise your answers, then
								review the proposed additions again.
							</p>
							<ul className="list-disc pl-5">
								{[...new Set(questions)].map((question) => (
									<li key={question}>{question}</li>
								))}
							</ul>
						</>
					) : (
						<p>No follow-up questions were suggested.</p>
					)}
				</div>
			)}
		</fieldset>
	);
}
