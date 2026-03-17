import {
  Action,
  ActionPanel,
  Alert,
  Clipboard,
  confirmAlert,
  Icon,
  List,
  LocalStorage,
  open,
  showToast,
  Toast,
} from "@raycast/api";
import { runAppleScript } from "@raycast/utils";
import { useEffect, useMemo, useState } from "react";
import fs from "fs";
import fsPath from "path";
import { useObsidianVaults, vaultPluginCheck } from "./utils/utils";
import { CaptureRecord } from "./utils/capture-history";

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatTimestamp(timestamp: number): string {
  const d = new Date(timestamp);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function readNoteContent(filePath: string): string {
  try {
    if (!fs.existsSync(filePath)) return "*File not found*";
    const raw = fs.readFileSync(filePath, "utf8");
    const noFrontmatter = raw.replace(/^---\n[\s\S]*?\n---\n*/, "");
    const noteDir = fsPath.dirname(filePath);
    return noFrontmatter.replace(/!\[\[([^\]]+)\]\]/g, (_match, name: string) => {
      const absPath = fsPath.join(noteDir, "attachments", name);
      if (fs.existsSync(absPath)) {
        return `![${name}](file://${absPath.replace(/ /g, "%20")})`;
      }
      return `![${name}]`;
    });
  } catch {
    return "*Unable to read file*";
  }
}

function parseDateFromFrontmatter(content: string): Date | null {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return null;
  const dateMatch = fmMatch[1].match(/^date:\s*(.+)$/m);
  if (!dateMatch) return null;
  const parsed = new Date(dateMatch[1].trim());
  return isNaN(parsed.getTime()) ? null : parsed;
}

export default function CaptureHistory() {
  const { ready, vaults: allVaults } = useObsidianVaults();
  const [vaultsWithPlugin] = useMemo(() => vaultPluginCheck(allVaults, "obsidian-advanced-uri"), [allVaults]);
  const [records, setRecords] = useState<CaptureRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showDetail, setShowDetail] = useState(true);

  async function loadHistory() {
    setIsLoading(true);

    const savedPath = await LocalStorage.getItem<string>("path");
    const captureDir = savedPath || "Capture";
    const allRecords: CaptureRecord[] = [];

    for (const vault of vaultsWithPlugin) {
      const dirPath = fsPath.join(vault.path, captureDir);
      if (!fs.existsSync(dirPath)) continue;

      const entries = fs.readdirSync(dirPath);
      for (const entry of entries) {
        if (!entry.endsWith(".md") || entry === "sortspec.md") continue;
        const fullPath = fsPath.join(dirPath, entry);
        try {
          const stat = fs.statSync(fullPath);
          if (!stat.isFile()) continue;
          const content = fs.readFileSync(fullPath, "utf8");
          const noteDate = parseDateFromFrontmatter(content);
          const timestamp = noteDate ? noteDate.getTime() : stat.mtimeMs;
          const hasLink = /\[.*?\]\(https?:\/\//.test(content);
          const hasScreenshots = /!\[\[.*?\.(png|jpg|jpeg|gif)\]\]/.test(content);

          allRecords.push({
            title: entry.replace(/\.md$/, ""),
            path: fullPath,
            vaultName: vault.name,
            timestamp,
            hasLink,
            hasScreenshots,
          });
        } catch {
          continue;
        }
      }
    }

    allRecords.sort((a, b) => b.timestamp - a.timestamp);
    setRecords(allRecords);
    setIsLoading(false);
  }

  useEffect(() => {
    if (ready && vaultsWithPlugin.length > 0) loadHistory();
  }, [ready, vaultsWithPlugin]);

  async function handleOpen(record: CaptureRecord) {
    const uri = `obsidian://open?path=${encodeURIComponent(record.path)}`;
    await open(uri);
    await runAppleScript('tell application "Obsidian" to activate');
  }

  async function handleCopyPath(record: CaptureRecord) {
    await Clipboard.copy(record.path);
    await showToast({ style: Toast.Style.Success, title: "Path copied" });
  }

  async function handleDelete(record: CaptureRecord) {
    if (
      await confirmAlert({
        title: "Delete Note",
        message: `Delete "${record.title}" and its attachments from disk?`,
        primaryAction: { title: "Delete", style: Alert.ActionStyle.Destructive },
      })
    ) {
      if (fs.existsSync(record.path)) {
        const content = fs.readFileSync(record.path, "utf8");
        const noteDir = fsPath.dirname(record.path);
        const attachmentsDir = fsPath.join(noteDir, "attachments");
        const embeds = [...content.matchAll(/!\[\[([^\]]+)\]\]/g)].map((m) => m[1]);
        for (const embed of embeds) {
          const embedPath = fsPath.join(attachmentsDir, embed);
          if (fs.existsSync(embedPath)) {
            fs.unlinkSync(embedPath);
          }
        }
        fs.unlinkSync(record.path);
      }
      await loadHistory();
      await showToast({ style: Toast.Style.Success, title: "Note and attachments deleted" });
    }
  }

  return (
    <List isLoading={isLoading} isShowingDetail={showDetail} searchBarPlaceholder="Search captures...">
      {records.length === 0 && !isLoading ? (
        <List.EmptyView title="No captures yet" description="Captured notes will appear here" />
      ) : (
        records.map((record, idx) => (
          <List.Item
            key={`${record.path}-${idx}`}
            title={record.title}
            subtitle={showDetail ? undefined : timeAgo(record.timestamp)}
            accessories={
              showDetail
                ? undefined
                : [
                    ...(record.hasScreenshots ? [{ icon: Icon.Camera, tooltip: "Has screenshots" }] : []),
                    ...(record.hasLink ? [{ icon: Icon.Globe, tooltip: "Has link" }] : []),
                    { text: record.vaultName, icon: Icon.Box },
                    { text: formatTimestamp(record.timestamp), icon: Icon.Clock },
                  ]
            }
            detail={
              <List.Item.Detail
                markdown={`# ${record.title}\n\n*${formatTimestamp(record.timestamp)}*\n\n---\n\n${readNoteContent(record.path)}`}
              />
            }
            actions={
              <ActionPanel>
                <Action
                  title="Open in Obsidian"
                  icon={Icon.ArrowRight}
                  onAction={() => handleOpen(record)}
                />
                <Action
                  title={showDetail ? "Hide Preview" : "Show Preview"}
                  icon={Icon.Eye}
                  shortcut={{ modifiers: ["cmd"], key: "y" }}
                  onAction={() => setShowDetail((prev) => !prev)}
                />
                <Action
                  title="Copy Path"
                  icon={Icon.CopyClipboard}
                  shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
                  onAction={() => handleCopyPath(record)}
                />
                <Action
                  title="Delete Note"
                  icon={Icon.Trash}
                  style={Action.Style.Destructive}
                  shortcut={{ modifiers: ["ctrl"], key: "x" }}
                  onAction={() => handleDelete(record)}
                />
                <Action
                  title="Refresh"
                  icon={Icon.ArrowClockwise}
                  shortcut={{ modifiers: ["cmd"], key: "r" }}
                  onAction={loadHistory}
                />
              </ActionPanel>
            }
          />
        ))
      )}
    </List>
  );
}
