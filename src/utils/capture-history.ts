import { LocalStorage } from "@raycast/api";

const STORAGE_KEY = "captureHistory";
const MAX_RECORDS = 50;

export interface CaptureRecord {
  title: string;
  path: string;
  vaultName: string;
  timestamp: number;
  hasLink: boolean;
  hasScreenshots: boolean;
}

export async function getCaptureHistory(): Promise<CaptureRecord[]> {
  const raw = await LocalStorage.getItem<string>(STORAGE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function addCaptureRecord(record: CaptureRecord): Promise<void> {
  const history = await getCaptureHistory();
  history.unshift(record);
  const trimmed = history.slice(0, MAX_RECORDS);
  await LocalStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
}

export async function removeCaptureRecord(timestamp: number): Promise<void> {
  const history = await getCaptureHistory();
  const filtered = history.filter((r) => r.timestamp !== timestamp);
  await LocalStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
}

export async function clearCaptureHistory(): Promise<void> {
  await LocalStorage.removeItem(STORAGE_KEY);
}
