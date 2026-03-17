import {
  Action,
  ActionPanel,
  Alert,
  Clipboard,
  Color,
  confirmAlert,
  Icon,
  List,
  open,
  showToast,
  Toast,
} from "@raycast/api";
import { runAppleScript } from "@raycast/utils";
import { useEffect, useState } from "react";
import fs from "fs";
import path from "path";
import {
  CaptureRecord,
  clearCaptureHistory,
  getCaptureHistory,
  removeCaptureRecord,
} from "./utils/capture-history";

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
    const noteDir = path.dirname(filePath);
    return noFrontmatter.replace(/!\[\[([^\]]+)\]\]/g, (_match, name: string) => {
      const absPath = path.join(noteDir, "attachments", name);
      if (fs.existsSync(absPath)) {
        return `![${name}](file://${absPath.replace(/ /g, "%20")})`;
      }
      return `![${name}]`;
    });
  } catch {
    return "*Unable to read file*";
  }
}

export default function CaptureHistory() {
  const [records, setRecords] = useState<CaptureRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showDetail, setShowDetail] = useState(true);

  async function loadHistory() {
    setIsLoading(true);
    const history = await getCaptureHistory();
    setRecords(history);
    setIsLoading(false);
  }

  useEffect(() => {
    loadHistory();
  }, []);

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
        const noteDir = path.dirname(record.path);
        const attachmentsDir = path.join(noteDir, "attachments");
        const embeds = [...content.matchAll(/!\[\[([^\]]+)\]\]/g)].map((m) => m[1]);
        for (const embed of embeds) {
          const embedPath = path.join(attachmentsDir, embed);
          if (fs.existsSync(embedPath)) {
            fs.unlinkSync(embedPath);
          }
        }
        fs.unlinkSync(record.path);
      }
      await removeCaptureRecord(record.timestamp);
      await loadHistory();
      await showToast({ style: Toast.Style.Success, title: "Note and attachments deleted" });
    }
  }

  async function handleClearAll() {
    if (
      await confirmAlert({
        title: "Clear All History",
        message: "This removes all entries from history but does not delete any files.",
        primaryAction: { title: "Clear", style: Alert.ActionStyle.Destructive },
      })
    ) {
      await clearCaptureHistory();
      await loadHistory();
      await showToast({ style: Toast.Style.Success, title: "History cleared" });
    }
  }

  return (
    <List isLoading={isLoading} isShowingDetail={showDetail} searchBarPlaceholder="Search captures...">
      {records.length === 0 && !isLoading ? (
        <List.EmptyView title="No captures yet" description="Captured notes will appear here" />
      ) : (
        records.map((record) => (
          <List.Item
            key={record.timestamp}
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
                markdown={readNoteContent(record.path)}
                metadata={
                  <List.Item.Detail.Metadata>
                    <List.Item.Detail.Metadata.Label title="Vault" text={record.vaultName} icon={Icon.Box} />
                    <List.Item.Detail.Metadata.Label title="Captured" text={formatTimestamp(record.timestamp)} icon={Icon.Clock} />
                    {record.hasLink && <List.Item.Detail.Metadata.Label title="Link" icon={Icon.Globe} text="Yes" />}
                    {record.hasScreenshots && <List.Item.Detail.Metadata.Label title="Screenshots" icon={Icon.Camera} text="Yes" />}
                    <List.Item.Detail.Metadata.Separator />
                    <List.Item.Detail.Metadata.Label title="Path" text={record.path} />
                  </List.Item.Detail.Metadata>
                }
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
                  title="Clear All History"
                  icon={Icon.XMarkCircle}
                  style={Action.Style.Destructive}
                  onAction={handleClearAll}
                />
              </ActionPanel>
            }
          />
        ))
      )}
    </List>
  );
}
