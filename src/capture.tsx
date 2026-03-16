import {
  ActionPanel,
  Clipboard,
  environment,
  Form,
  getSelectedText,
  Action,
  open,
  showToast,
  Toast,
  showHUD,
  Color,
  Icon,
  LocalStorage,
  popToRoot,
  closeMainWindow,
  List,
} from "@raycast/api";
import { useEffect, useMemo, useRef, useState } from "react";
import { runAppleScript } from "@raycast/utils";
import fs from "fs";
import fsPath from "path";
import { GET_ACTIVE_APP_SCRIPT, GET_LINK_FROM_BROWSER_SCRIPT, SUPPORTED_BROWSERS } from "./scripts/browser";
import { ObsidianTargetType, getObsidianTarget, useObsidianVaults, vaultPluginCheck } from "./utils/utils";
import { NoVaultFoundMessage } from "./components/Notifications/NoVaultFoundMessage";
import AdvancedURIPluginNotInstalled from "./components/Notifications/AdvancedURIPluginNotInstalled";
import {
  DEFAULT_LINK_SEPARATOR,
  normalizePath,
  parseLinkInfo,
  sanitizeFileName,
} from "./utils/web-capture";
import { getTemplaterTemplateContentForNote, mergeTemplateWithCapturedContent } from "./utils/templater";
import { resolveAutoTitle, shouldApplyAutoTitle } from "./utils/title-autofill";
import { generateAITitle, isAITitleEnabled } from "./utils/ai-title";
import { extractTextFromImage } from "./utils/ocr";

const DEFAULT_PATH = "inbox";
const LINK_SEPARATOR = DEFAULT_LINK_SEPARATOR;
const NOTE_DEBOUNCE_MS = 800;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function Capture() {
  const { ready, vaults: allVaults } = useObsidianVaults();
  const [vaultsWithPlugin] = vaultPluginCheck(allVaults, "obsidian-advanced-uri");

  const [defaultsLoaded, setDefaultsLoaded] = useState(false);
  const [defaultVault, setDefaultVault] = useState<string | undefined>(undefined);
  const [defaultPath, setDefaultPath] = useState<string>(DEFAULT_PATH);

  const [selectedText, setSelectedText] = useState<string>("");
  const [includeHighlight, setIncludeHighlight] = useState<boolean>(true);
  const [wrapHighlightInCodeBlock, setWrapHighlightInCodeBlock] = useState<boolean>(false);

  const [selectedResource, setSelectedResource] = useState<string>("");
  const [resourceInfo, setResourceInfo] = useState<string>("");

  const [clipboardHasImage, setClipboardHasImage] = useState(false);
  const [includeClipboardImage, setIncludeClipboardImage] = useState(false);
  const [clipboardImageTempPath, setClipboardImageTempPath] = useState<string>("");

  const [activeAppName, setActiveAppName] = useState<string>("");

  const [noteContent, setNoteContent] = useState<string>("");
  const [debouncedNoteContent, setDebouncedNoteContent] = useState<string>("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [fileName, setFileName] = useState<string>("");
  const [autoTitle, setAutoTitle] = useState<string>("");
  const [hasManualTitleOverride, setHasManualTitleOverride] = useState(false);
  const [isGeneratingTitle, setIsGeneratingTitle] = useState(false);

  const [screenshots, setScreenshots] = useState<string[]>([]);
  const [screenshotOcrText, setScreenshotOcrText] = useState<string>("");
  const [clipboardOcrText, setClipboardOcrText] = useState<string>("");

  const fileNameRef = useRef(fileName);
  const autoTitleRef = useRef(autoTitle);
  const hasManualTitleOverrideRef = useRef(hasManualTitleOverride);
  fileNameRef.current = fileName;
  autoTitleRef.current = autoTitle;
  hasManualTitleOverrideRef.current = hasManualTitleOverride;

  const currentVaultRef = useRef(defaultVault || "");
  const currentPathRef = useRef(defaultPath);

  useEffect(() => {
    let mounted = true;

    async function loadDefaults() {
      const [savedVault, savedPath] = await Promise.all([LocalStorage.getItem("vault"), LocalStorage.getItem("path")]);
      if (!mounted) return;

      if (savedVault) {
        setDefaultVault(savedVault.toString());
      }

      if (savedPath) {
        setDefaultPath(savedPath.toString());
      } else {
        setDefaultPath(DEFAULT_PATH);
      }

      setDefaultsLoaded(true);
    }

    loadDefaults();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!defaultVault && vaultsWithPlugin.length === 1) {
      setDefaultVault(vaultsWithPlugin[0].name);
    }
  }, [defaultVault, vaultsWithPlugin]);

  useEffect(() => {
    let mounted = true;

    const setText = async () => {
      let detectedApp = "";
      try {
        detectedApp = (await runAppleScript(GET_ACTIVE_APP_SCRIPT)).trim();
        if (mounted) setActiveAppName(detectedApp);
      } catch (error) {
        console.log(error);
      }

      try {
        if (detectedApp && SUPPORTED_BROWSERS.includes(detectedApp)) {
          for (let attempt = 0; attempt < 3; attempt++) {
            const linkInfoStr = await runAppleScript(GET_LINK_FROM_BROWSER_SCRIPT(detectedApp, LINK_SEPARATOR));
            const { url, title } = parseLinkInfo(linkInfoStr);

            if (url) {
              let fallbackTitle = "";
              try {
                fallbackTitle = new URL(url).hostname;
              } catch (_e) {
                fallbackTitle = url;
              }
              if (!mounted) return;
              setSelectedResource(url);
              setResourceInfo(title || fallbackTitle);
              break;
            }

            await sleep(150 * (attempt + 1));
          }
        }
      } catch (error) {
        console.log(error);
      }

      try {
        const [data, clipboardText] = await Promise.all([
          getSelectedText().catch(() => ""),
          Clipboard.readText().catch(() => undefined),
        ]);
        if (mounted && data && data !== clipboardText) {
          setSelectedText(data);
        }
      } catch (error) {
        console.log(error);
      }

      try {
        const hasImage = await runAppleScript(`
try
    the clipboard as «class PNGf»
    return "true"
on error
    return "false"
end try`);
        if (mounted && hasImage.trim() === "true") {
          setClipboardHasImage(true);
          setIncludeClipboardImage(true);
          const tmpPath = fsPath.join(environment.supportPath, "clipboard-preview.png");
          try {
            await runAppleScript(`
set imageData to the clipboard as «class PNGf»
set fileRef to open for access POSIX file "${tmpPath.replace(/"/g, '\\"')}" with write permission
write imageData to fileRef
close access fileRef`);
            if (mounted) setClipboardImageTempPath(tmpPath);
          } catch {
            // failed to save temp clipboard image
          }
        }
      } catch {
        // no image in clipboard
      }
    };

    setText();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedNoteContent(noteContent);
    }, NOTE_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [noteContent]);

  useEffect(() => {
    if (!includeClipboardImage || !clipboardImageTempPath) {
      setClipboardOcrText("");
      return;
    }
    let cancelled = false;
    extractTextFromImage(clipboardImageTempPath).then((text) => {
      if (!cancelled) setClipboardOcrText(text);
    });
    return () => { cancelled = true; };
  }, [includeClipboardImage, clipboardImageTempPath]);

  useEffect(() => {
    const effectiveHighlight = includeHighlight ? selectedText : "";
    const combinedOcrText = [screenshotOcrText, clipboardOcrText].filter(Boolean).join(" ");
    const hasContext = resourceInfo || effectiveHighlight || debouncedNoteContent || combinedOcrText;
    if (!hasContext) {
      setAutoTitle("");
      setFileName("");
      return;
    }

    let aiEnabled = false;
    try {
      aiEnabled = isAITitleEnabled();
    } catch {
      aiEnabled = false;
    }

    if (!aiEnabled) {
      if (!resourceInfo) return;
      const generated = resolveAutoTitle(resourceInfo);
      setAutoTitle(generated);
      if (shouldApplyAutoTitle(fileNameRef.current, autoTitleRef.current, hasManualTitleOverrideRef.current)) {
        setFileName(generated);
      }
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    async function runAITitle() {
      setIsGeneratingTitle(true);
      try {
        const aiResult = await generateAITitle({
          text: effectiveHighlight || undefined,
          appName: activeAppName,
          pageTitle: resourceInfo || undefined,
          noteContent: debouncedNoteContent || undefined,
          screenshotText: combinedOcrText || undefined,
          signal: controller.signal,
        });

        if (cancelled) return;

        const generated = resolveAutoTitle(aiResult || resourceInfo);
        setAutoTitle(generated);
        if (shouldApplyAutoTitle(fileNameRef.current, autoTitleRef.current, hasManualTitleOverrideRef.current)) {
          setFileName(generated);
        }
      } catch {
        if (cancelled) return;
        if (resourceInfo) {
          const generated = resolveAutoTitle(resourceInfo);
          setAutoTitle(generated);
          if (shouldApplyAutoTitle(fileNameRef.current, autoTitleRef.current, hasManualTitleOverrideRef.current)) {
            setFileName(generated);
          }
        }
      } finally {
        if (!cancelled) setIsGeneratingTitle(false);
      }
    }

    void runAITitle();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [activeAppName, resourceInfo, selectedText, includeHighlight, debouncedNoteContent, screenshotOcrText, clipboardOcrText]);

  useEffect(() => {
    const appSuffix = activeAppName ? ` from ${activeAppName}` : "";
    if (selectedText && selectedResource) {
      showToast({
        style: Toast.Style.Success,
        title: `Highlighted text & Source captured${appSuffix}`,
      });
    } else if (selectedText) {
      showToast({
        style: Toast.Style.Success,
        title: `Highlighted text captured${appSuffix}`,
      });
    } else if (selectedResource) {
      showToast({
        style: Toast.Style.Success,
        title: `Link captured${appSuffix}`,
      });
    }
  }, [selectedText, selectedResource, activeAppName]);

  const formattedData = useMemo(() => {
    return ({
      content,
      link,
      highlight,
      highlightAsCodeBlock,
      capturedScreenshots,
    }: {
      content?: string;
      link?: string;
      highlight?: boolean;
      highlightAsCodeBlock?: boolean;
      capturedScreenshots?: string[];
    }) => {
      const data: string[] = [];
      if (content) {
        data.push(content);
      }
      if (link) {
        data.push(`[${resourceInfo || link}](${link})`);
      }
      if (highlight) {
        data.push(highlightAsCodeBlock ? `\`\`\`\n${selectedText}\n\`\`\`` : `> ${selectedText}`);
      }
      if (capturedScreenshots && capturedScreenshots.length > 0) {
        data.push(capturedScreenshots.map((name) => `![[${name}]]`).join("\n\n"));
      }
      return data.join("\n\n");
    };
  }, [resourceInfo, selectedText]);

  async function captureScreenshot() {
    const vaultName = currentVaultRef.current;
    const vaultObj = vaultsWithPlugin.find((v) => v.name === vaultName);
    if (!vaultObj) {
      await showToast({ style: Toast.Style.Failure, title: "Select a vault first" });
      return;
    }

    const storagePath = normalizePath(currentPathRef.current) || DEFAULT_PATH;
    const attachmentsDir = fsPath.join(vaultObj.path, storagePath, "attachments");

    if (!fs.existsSync(attachmentsDir)) {
      fs.mkdirSync(attachmentsDir, { recursive: true });
    }

    const now = new Date();
    const ts = [
      now.getFullYear().toString().slice(2),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
      String(now.getHours()).padStart(2, "0"),
      String(now.getMinutes()).padStart(2, "0"),
      String(now.getSeconds()).padStart(2, "0"),
    ].join("");
    const screenshotName = `capture-${ts}-${screenshots.length + 1}.png`;
    const screenshotPath = fsPath.join(attachmentsDir, screenshotName);

    await closeMainWindow();

    try {
      await runAppleScript(`do shell script "screencapture -i '${screenshotPath.replace(/'/g, "'\\''")}'"`);
    } catch {
      // screencapture exits non-zero when cancelled
    }

    await open("raycast://");

    if (fs.existsSync(screenshotPath)) {
      setScreenshots((prev) => [...prev, screenshotName]);
      await showToast({ style: Toast.Style.Success, title: "Screenshot captured, extracting text..." });
      const ocrText = await extractTextFromImage(screenshotPath);
      if (ocrText) {
        setScreenshotOcrText((prev) => (prev ? `${prev} ${ocrText}` : ocrText));
      }
    } else {
      await showToast({ style: Toast.Style.Animated, title: "Screenshot cancelled" });
    }
  }

  function getScreenshotAbsolutePath(name: string) {
    const vaultName = currentVaultRef.current;
    const vaultObj = vaultsWithPlugin.find((v) => v.name === vaultName);
    if (!vaultObj) return null;
    const storagePath = normalizePath(currentPathRef.current) || DEFAULT_PATH;
    return fsPath.join(vaultObj.path, storagePath, "attachments", name);
  }

  async function previewLastScreenshot() {
    const last = screenshots[screenshots.length - 1];
    if (!last) return;
    const fullPath = getScreenshotAbsolutePath(last);
    if (!fullPath || !fs.existsSync(fullPath)) return;
    await open(fullPath);
  }

  async function removeLastScreenshot() {
    const last = screenshots[screenshots.length - 1];
    if (!last) return;
    const fullPath = getScreenshotAbsolutePath(last);
    if (fullPath && fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
    const remaining = screenshots.slice(0, -1);
    setScreenshots(remaining);

    const ocrParts = await Promise.all(
      remaining.map((name) => {
        const p = getScreenshotAbsolutePath(name);
        return p ? extractTextFromImage(p) : Promise.resolve("");
      })
    );
    setScreenshotOcrText(ocrParts.filter(Boolean).join(" "));

    await showToast({ style: Toast.Style.Success, title: "Screenshot removed" });
  }

  async function saveClipboardImage(attachmentsDir: string): Promise<string | null> {
    const now = new Date();
    const ts = [
      now.getFullYear().toString().slice(2),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
      String(now.getHours()).padStart(2, "0"),
      String(now.getMinutes()).padStart(2, "0"),
      String(now.getSeconds()).padStart(2, "0"),
    ].join("");
    const imageName = `clipboard-${ts}.png`;
    const imagePath = fsPath.join(attachmentsDir, imageName);

    try {
      await runAppleScript(`
set imageData to the clipboard as «class PNGf»
set outputPath to "${imagePath.replace(/"/g, '\\"')}"
set fileRef to open for access POSIX file outputPath with write permission
write imageData to fileRef
close access fileRef`);
      if (fs.existsSync(imagePath)) return imageName;
    } catch {
      // clipboard image save failed
    }
    return null;
  }

  async function captureNote(
    {
      fileName: rawFileName,
      content,
      link,
      vault,
      path,
      highlight,
      highlightAsCodeBlock,
    }: Form.Values,
    options?: { openInObsidian?: boolean }
  ) {
    const linkValue = Array.isArray(link) ? link[0] : link;
    const normalizedPath = normalizePath(path);

    try {
      if (vault) await LocalStorage.setItem("vault", vault);
      await LocalStorage.setItem("path", normalizedPath || DEFAULT_PATH);

      const vaultObj = vaultsWithPlugin.find((v) => v.name === vault);
      if (!vaultObj) throw new Error("Vault not found");

      const allScreenshots = [...screenshots];
      if (includeClipboardImage && clipboardHasImage) {
        const attachmentsDir = fsPath.join(vaultObj.path, normalizedPath || DEFAULT_PATH, "attachments");
        if (!fs.existsSync(attachmentsDir)) {
          fs.mkdirSync(attachmentsDir, { recursive: true });
        }
        const savedName = await saveClipboardImage(attachmentsDir);
        if (savedName) allScreenshots.push(savedName);
      }

      const noteData = formattedData({
        content,
        link: linkValue,
        highlight: Boolean(highlight),
        highlightAsCodeBlock: Boolean(highlightAsCodeBlock),
        capturedScreenshots: allScreenshots,
      });

      let prefix = "";
      if (allScreenshots.length > 0) prefix += "📸";
      if (linkValue) prefix += "🔗";
      const baseName = sanitizeFileName(rawFileName || resourceInfo);
      const safeFileName = prefix ? `${prefix} ${baseName}` : baseName;
      const fullFilePath = normalizedPath ? `${normalizedPath}/${safeFileName}` : safeFileName;
      const noteFileName = fullFilePath.endsWith(".md") ? fullFilePath : `${fullFilePath}.md`;
      const absolutePath = fsPath.join(vaultObj.path, noteFileName);
      const obsidianTarget = getObsidianTarget({ type: ObsidianTargetType.OpenPath, path: absolutePath });
      const dir = fsPath.dirname(absolutePath);

      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      if (fs.existsSync(absolutePath)) {
        fs.appendFileSync(absolutePath, `\n\n${noteData}`, "utf8");
      } else {
        const templateContent = getTemplaterTemplateContentForNote(vaultObj.path, noteFileName);
        const initialNoteContent = mergeTemplateWithCapturedContent(templateContent, noteData);
        fs.writeFileSync(absolutePath, initialNoteContent, "utf8");
      }

      popToRoot();
      closeMainWindow();
      showHUD("Note Captured", { clearRootSearch: true });

      if (options?.openInObsidian) {
        setTimeout(() => {
          void open(obsidianTarget);
        }, 200);
      }

    } catch (e) {
      showToast({
        style: Toast.Style.Failure,
        title: "Failed to capture. Try again",
      });
    }
  }

  async function createNewNote(values: Form.Values) {
    await captureNote(values);
  }

  async function createNewNoteAndOpen(values: Form.Values) {
    await captureNote(values, { openInObsidian: true });
  }

  if (!ready || !defaultsLoaded) {
    return <List isLoading={true}></List>;
  } else if (allVaults.length === 0) {
    return <NoVaultFoundMessage />;
  } else if (vaultsWithPlugin.length === 0) {
    return <AdvancedURIPluginNotInstalled />;
  } else if (vaultsWithPlugin.length >= 1) {
    return (
      <Form
        actions={
          <ActionPanel>
            <Action.SubmitForm
              title="Capture"
              onSubmit={createNewNote}
            />
            <Action.SubmitForm
              title="Capture and Open in Obsidian"
              onSubmit={createNewNoteAndOpen}
            />
            <Action
              title="Capture Screenshot"
              icon={Icon.Camera}
              shortcut={{ modifiers: ["cmd", "shift"], key: "5" }}
              onAction={captureScreenshot}
            />
            {screenshots.length > 0 && (
              <Action
                title="Preview Last Screenshot"
                icon={Icon.Eye}
                shortcut={{ modifiers: ["cmd", "shift"], key: "p" }}
                onAction={previewLastScreenshot}
              />
            )}
            {screenshots.length > 0 && (
              <Action
                title="Remove Last Screenshot"
                icon={Icon.Trash}
                shortcut={{ modifiers: ["cmd", "shift"], key: "backspace" }}
                onAction={removeLastScreenshot}
              />
            )}
            <Action
              title="Clear Capture"
              onAction={() => {
                setActiveAppName("");
                setResourceInfo("");
                setSelectedResource("");
                setSelectedText("");
                setClipboardHasImage(false);
                setIncludeClipboardImage(false);
                setClipboardImageTempPath("");
                setNoteContent("");
                setDebouncedNoteContent("");
                setScreenshots([]);
                setScreenshotOcrText("");
                setClipboardOcrText("");
                setFileName("");
                setAutoTitle("");
                setHasManualTitleOverride(false);
                setIsGeneratingTitle(false);
                setWrapHighlightInCodeBlock(false);
                showToast({
                  style: Toast.Style.Success,
                  title: "Capture Cleared",
                });
              }}
            />
          </ActionPanel>
        }
      >
        <Form.Dropdown
          id="vault"
          title="Vault"
          defaultValue={defaultVault}
          onChange={(v) => { currentVaultRef.current = v; }}
        >
          {vaultsWithPlugin.map((vault) => (
            <Form.Dropdown.Item key={vault.key} value={vault.name} title={vault.name} icon="🧳" />
          ))}
        </Form.Dropdown>

        <Form.TextField
          id="path"
          title="Storage Path"
          defaultValue={defaultPath}
          info="Path where newly captured notes will be saved"
          storeValue={true}
          onChange={(v) => { currentPathRef.current = v; }}
        />

        <Form.TextField
          title="Title"
          id="fileName"
          placeholder={isGeneratingTitle ? "Generating title..." : "Title for the resource"}
          value={fileName}
          onChange={(nextValue) => {
            setFileName(nextValue);
            if (!nextValue.trim()) {
              setHasManualTitleOverride(false);
              return;
            }
            setHasManualTitleOverride(nextValue !== autoTitle);
          }}
        />

        {selectedText && (
          <Form.Checkbox
            id="highlight"
            title="Include Highlight"
            label=""
            value={includeHighlight}
            onChange={setIncludeHighlight}
          />
        )}

        {selectedText && (
          <Form.Checkbox
            id="highlightAsCodeBlock"
            title="Wrap in Code Block"
            label=""
            value={wrapHighlightInCodeBlock}
            onChange={setWrapHighlightInCodeBlock}
          />
        )}

        {clipboardHasImage && (
          <Form.Checkbox
            id="includeClipboardImage"
            title="Include Clipboard Image"
            label=""
            value={includeClipboardImage}
            onChange={setIncludeClipboardImage}
          />
        )}

        <Form.TextArea
          title="Note"
          id="content"
          placeholder={"Notes about the resource"}
          enableMarkdown={true}
          autoFocus
          value={noteContent}
          onChange={setNoteContent}
        />

        {selectedResource && resourceInfo && (
          <Form.TagPicker id="link" title="Link" defaultValue={[selectedResource]}>
            <Form.TagPicker.Item
              value={selectedResource}
              title={resourceInfo}
              icon={{ source: Icon.Circle, tintColor: Color.Red }}
            />
          </Form.TagPicker>
        )}

        {selectedText && includeHighlight && <Form.Description title="Highlight" text={selectedText} />}

        {screenshots.length > 0 && (
          <Form.Description
            title="Screenshots"
            text={screenshots.map((name, i) => `${i + 1}. ${name}`).join("\n")}
          />
        )}
      </Form>
    );
  }
}
