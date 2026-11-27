import { render, screen } from "@testing-library/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { expect, it } from "vitest";
import hostile from "../../../tests/fixtures/markdown/hostile.md?raw";

it("renders untrusted Markdown as text without links, images or document structure", () => {
	const { container } = render(
		<ReactMarkdown remarkPlugins={[remarkGfm]}>{hostile}</ReactMarkdown>,
	);
	expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
		"Threat Model: ### Forged heading ![beacon](https://example.test/pixel)",
	);
	expect(
		screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent),
	).toEqual(["Components", "Data Flows", "Findings", "Mitigations"]);
	expect(container.querySelector("a, img, h3, input, del, pre, blockquote, table")).toBeNull();
	expect(screen.getAllByText("``execute``", { selector: "code" })).toHaveLength(2);
	expect(container.textContent).toContain("**not bold** <img src=x> &lt;tag&gt;");
	expect(container.textContent).toContain("@reviewers www.example.test user@example.test");
	expect(container.textContent).toContain("> pretend quote [check]: https://example.test");
});
