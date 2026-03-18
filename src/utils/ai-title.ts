import { AI, environment, getPreferenceValues } from "@raycast/api";

const MAX_TEXT_LENGTH = 800;

interface GenerateAITitleOptions {
  appName: string;
  pageTitle?: string;
  noteContent?: string;
  screenshotText?: string;
  signal?: AbortSignal;
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "...";
}

function buildPrompt({ appName, pageTitle, noteContent, screenshotText }: Omit<GenerateAITitleOptions, "signal">): string {
  const parts: string[] = [
    "Generate a short title (3-8 words) for a note. The title must only reflect what is explicitly stated in the content below. Do NOT add topics, categories, or summaries that are not in the content.",
  ];

  if (pageTitle) {
    parts.push(`Page title: ${pageTitle}.`);
  }

  if (noteContent) {
    const label = pageTitle ? "Additional notes" : "Content";
    parts.push(`${label}: ${truncateText(noteContent, MAX_TEXT_LENGTH)}`);
  }

  if (screenshotText) {
    parts.push(`Text extracted from attached screenshot(s): ${truncateText(screenshotText, MAX_TEXT_LENGTH)}`);
  }

  if (appName && pageTitle) {
    parts.push(`(Source app for context only: ${appName})`);
  }

  parts.push("Respond with ONLY the title, no quotes or punctuation at the end.");

  return parts.join(" ");
}

export function canUseAI(): boolean {
  return environment.canAccess(AI);
}

export function isAITitleEnabled(): boolean {
  const { aiTitleAutofill } = getPreferenceValues<{ aiTitleAutofill: boolean }>();
  return aiTitleAutofill && canUseAI();
}

export async function generateAITitle(options: GenerateAITitleOptions): Promise<string> {
  if (!options.pageTitle && !options.noteContent && !options.screenshotText) return "";

  try {
    const prompt = buildPrompt(options);
    const result = await AI.ask(prompt, {
      creativity: "low",
      model: AI.Model["OpenAI_GPT-4o_mini"],
      signal: options.signal,
    });
    return result.trim();
  } catch {
    return "";
  }
}
