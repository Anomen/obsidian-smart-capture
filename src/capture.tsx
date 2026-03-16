import {
  ActionPanel,
  Clipboard,
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
  classifyFetchError,
  DEFAULT_LINK_SEPARATOR,
  fetchPageContent,
  normalizePath,
  parseLinkInfo,
  sanitizeFileName,
} from "./utils/web-capture";
import { getTemplaterTemplateContentForNote, mergeTemplateWithCapturedContent } from "./utils/templater";
import { resolveAutoTitle, shouldApplyAutoTitle } from "./utils/title-autofill";
import { generateAITitle, isAITitleEnabled } from "./utils/ai-title";

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
  const [includePageContent, setIncludePageContent] = useState<boolean>(false);

  const [selectedResource, setSelectedResource] = useState<string>("");
  const [resourceInfo, setResourceInfo] = useState<string>("");

  const [activeAppName, setActiveAppName] = useState<string>("");

  const [noteContent, setNoteContent] = useState<string>("");
  const [debouncedNoteContent, setDebouncedNoteContent] = useState<string>("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [fileName, setFileName] = useState<string>("");
  const [autoTitle, setAutoTitle] = useState<string>("");
  const [hasManualTitleOverride, setHasManualTitleOverride] = useState(false);
  const [isGeneratingTitle, setIsGeneratingTitle] = useState(false);

  const fileNameRef = useRef(fileName);
  const autoTitleRef = useRef(autoTitle);
  const hasManualTitleOverrideRef = useRef(hasManualTitleOverride);
  fileNameRef.current = fileName;
  autoTitleRef.current = autoTitle;
  hasManualTitleOverrideRef.current = hasManualTitleOverride;

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
    const effectiveHighlight = includeHighlight ? selectedText : "";
    const hasContext = resourceInfo || effectiveHighlight || debouncedNoteContent;
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
  }, [activeAppName, resourceInfo, selectedText, includeHighlight, debouncedNoteContent]);

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
      pageContent,
    }: {
      content?: string;
      link?: string;
      highlight?: boolean;
      highlightAsCodeBlock?: boolean;
      pageContent?: string;
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
      if (pageContent) {
        data.push(`## Page Content\n\n${pageContent}`);
      }
      return data.join("\n\n");
    };
  }, [resourceInfo, selectedText]);

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
    const safeFileName = sanitizeFileName(rawFileName || resourceInfo);
    const normalizedPath = normalizePath(path);
    const fullFilePath = normalizedPath ? `${normalizedPath}/${safeFileName}` : safeFileName;

    let fetchedPageContent = "";
    let fetchWarning = "";

    if (includePageContent && linkValue) {
      try {
        const fetched = await fetchPageContent(linkValue);
        fetchedPageContent = fetched.content;
        fetchWarning = fetched.warning || "";
      } catch (error) {
        fetchedPageContent = `Source: ${linkValue}`;
        fetchWarning = classifyFetchError(error);
      }
    }

    try {
      if (vault) await LocalStorage.setItem("vault", vault);
      await LocalStorage.setItem("path", normalizedPath || DEFAULT_PATH);

      const vaultObj = vaultsWithPlugin.find((v) => v.name === vault);
      if (!vaultObj) throw new Error("Vault not found");

      const noteData = formattedData({
        content,
        link: linkValue,
        highlight: Boolean(highlight),
        highlightAsCodeBlock: Boolean(highlightAsCodeBlock),
        pageContent: fetchedPageContent,
      });

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

      if (fetchWarning) {
        await showToast({
          style: Toast.Style.Failure,
          title: fetchWarning,
        });
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
              title="Clear Capture"
              onAction={() => {
                setActiveAppName("");
                setResourceInfo("");
                setSelectedResource("");
                setSelectedText("");
                setNoteContent("");
                setDebouncedNoteContent("");
                setFileName("");
                setAutoTitle("");
                setHasManualTitleOverride(false);
                setIsGeneratingTitle(false);
                setWrapHighlightInCodeBlock(false);
                setIncludePageContent(false);
                showToast({
                  style: Toast.Style.Success,
                  title: "Capture Cleared",
                });
              }}
            />
          </ActionPanel>
        }
      >
        <Form.Dropdown id="vault" title="Vault" defaultValue={defaultVault}>
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

        {selectedResource && (
          <Form.Checkbox
            id="includePageContent"
            title="Include page content"
            label=""
            value={includePageContent}
            onChange={setIncludePageContent}
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
      </Form>
    );
  }
}
