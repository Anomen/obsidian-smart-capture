import { AI, environment, getPreferenceValues } from "@raycast/api";

const MAX_TEXT_LENGTH = 800;

interface GenerateAITitleOptions {
  text?: string;
  appName: string;
  pageTitle?: string;
  signal?: AbortSignal;
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "...";
}

function buildPrompt({ text, appName, pageTitle }: Omit<GenerateAITitleOptions, "signal">): string {
  const parts: string[] = [
    "Generate a short, descriptive title (3-8 words) for a note.",
  ];

  if (pageTitle) {
    parts.push(`The page title is: ${pageTitle}.`);
    if (text) {
      parts.push(`Highlighted text from the page: ${truncateText(text, MAX_TEXT_LENGTH)}`);
    }
  } else {
    parts.push(`The text was captured from ${appName}.`);
    if (text) {
      parts.push(`Text: ${truncateText(text, MAX_TEXT_LENGTH)}`);
    }
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
  if (!options.text && !options.pageTitle) return "";

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
