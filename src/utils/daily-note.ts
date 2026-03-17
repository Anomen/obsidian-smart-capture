import fs from "fs";
import path from "path";
import { open } from "@raycast/api";

interface PeriodicNotesConfig {
  daily?: {
    format?: string;
    folder?: string;
    enabled?: boolean;
    template?: string;
  };
}

const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function formatDateToken(format: string, date: Date): string {
  let result = "";
  let i = 0;

  while (i < format.length) {
    if (format[i] === "[") {
      const closeIdx = format.indexOf("]", i + 1);
      if (closeIdx !== -1) {
        result += format.slice(i + 1, closeIdx);
        i = closeIdx + 1;
        continue;
      }
    }

    if (format.startsWith("YYYY", i)) {
      result += date.getFullYear().toString();
      i += 4;
    } else if (format.startsWith("MMMM", i)) {
      result += MONTHS_FULL[date.getMonth()];
      i += 4;
    } else if (format.startsWith("MM", i)) {
      result += String(date.getMonth() + 1).padStart(2, "0");
      i += 2;
    } else if (format.startsWith("DD", i)) {
      result += String(date.getDate()).padStart(2, "0");
      i += 2;
    } else if (format.startsWith("ddd", i)) {
      result += WEEKDAYS_SHORT[date.getDay()];
      i += 3;
    } else if (format.startsWith("HH", i)) {
      result += String(date.getHours()).padStart(2, "0");
      i += 2;
    } else if (format.startsWith("mm", i)) {
      result += String(date.getMinutes()).padStart(2, "0");
      i += 2;
    } else {
      result += format[i];
      i += 1;
    }
  }

  return result;
}

function readPeriodicNotesConfig(vaultPath: string): PeriodicNotesConfig | null {
  const configPath = path.join(vaultPath, ".obsidian", "plugins", "periodic-notes", "data.json");
  if (!fs.existsSync(configPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    return null;
  }
}

export function getDailyNotePath(vaultPath: string, date?: Date): string | null {
  const config = readPeriodicNotesConfig(vaultPath);
  if (!config?.daily?.enabled || !config.daily.format) return null;

  const folder = config.daily.folder || "";
  const formatted = formatDateToken(config.daily.format, date ?? new Date());

  return path.join(vaultPath, folder, `${formatted}.md`);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function ensureDailyNote(vaultPath: string, vaultName: string): Promise<string | null> {
  const notePath = getDailyNotePath(vaultPath);
  if (!notePath) return null;

  if (fs.existsSync(notePath)) return notePath;

  const dir = path.dirname(notePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  await open(`obsidian://advanced-uri?daily=true&vault=${encodeURIComponent(vaultName)}`);

  for (let i = 0; i < 6; i++) {
    await sleep(500);
    if (fs.existsSync(notePath)) return notePath;
  }

  return null;
}

export function removeCaptureFromDailyNote(vaultPath: string, captureRelativePath: string, captureDate: Date): void {
  const dailyNotePath = getDailyNotePath(vaultPath, captureDate);
  if (!dailyNotePath || !fs.existsSync(dailyNotePath)) return;

  const content = fs.readFileSync(dailyNotePath, "utf8");
  const noteName = path.basename(captureRelativePath, ".md");
  const filtered = content
    .split("\n")
    .filter((line) => !line.includes(`[[${noteName}]]`))
    .join("\n");

  if (filtered !== content) {
    fs.writeFileSync(dailyNotePath, filtered, "utf8");
  }
}

export function appendCaptureToDailyNote(dailyNotePath: string, captureNoteName: string): void {
  if (!fs.existsSync(dailyNotePath)) return;

  const content = fs.readFileSync(dailyNotePath, "utf8");
  const lines = content.split("\n");
  const now = new Date();
  const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const linkLine = `- ${time} ― [[${captureNoteName}]]`;

  const capturesIdx = lines.findIndex((line) => /^#\s+Captures\s*$/.test(line));

  if (capturesIdx !== -1) {
    let insertIdx = lines.length;
    for (let i = capturesIdx + 1; i < lines.length; i++) {
      if (/^#{1,6}\s/.test(lines[i])) {
        insertIdx = i;
        break;
      }
    }
    lines.splice(insertIdx, 0, linkLine);
  } else {
    lines.push("", "# Captures", linkLine);
  }

  fs.writeFileSync(dailyNotePath, lines.join("\n"), "utf8");
}
