import {
  ActionPanel,
  Form,
  getSelectedText,
  Action,
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
import { useEffect, useMemo, useState } from "react";
import { runAppleScript } from "@raycast/utils";
import fs from "fs";
import fsPath from "path";
import { GET_ACTIVE_APP_SCRIPT, GET_LINK_FROM_BROWSER_SCRIPT, SUPPORTED_BROWSERS } from "./scripts/browser";
import { useObsidianVaults, vaultPluginCheck } from "./utils/utils";
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

const DEFAULT_PATH = "inbox";
const LINK_SEPARATOR = DEFAULT_LINK_SEPARATOR;

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
  const [includePageContent, setIncludePageContent] = useState<boolean>(false);

  const [selectedResource, setSelectedResource] = useState<string>("");
  const [resourceInfo, setResourceInfo] = useState<string>("");

  const [fileName, setFileName] = useState<string>("");
  const [autoTitle, setAutoTitle] = useState<string>("");
  const [hasManualTitleOverride, setHasManualTitleOverride] = useState(false);

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
      try {
        for (let attempt = 0; attempt < 3; attempt++) {
          const activeApp = (await runAppleScript(GET_ACTIVE_APP_SCRIPT)).trim();
          if (!SUPPORTED_BROWSERS.includes(activeApp)) {
            break;
          }

          const linkInfoStr = await runAppleScript(GET_LINK_FROM_BROWSER_SCRIPT(activeApp, LINK_SEPARATOR));
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
      } catch (error) {
        console.log(error);
      }

      try {
        const data = await getSelectedText();
        if (mounted && data) {
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
    if (!resourceInfo) {
      return;
    }

    const generated = resolveAutoTitle(resourceInfo);
    setAutoTitle(generated);

    // Keep auto-filling title until user explicitly overrides it.
    if (shouldApplyAutoTitle(fileName, autoTitle, hasManualTitleOverride)) {
      setFileName(generated);
    }
  }, [resourceInfo, hasManualTitleOverride, fileName, autoTitle]);

  useEffect(() => {
    if (selectedText && selectedResource) {
      showToast({
        style: Toast.Style.Success,
        title: "Highlighted text & Source captured",
      });
    } else if (selectedText) {
      showToast({
        style: Toast.Style.Success,
        title: "Highlighted text captured",
      });
    } else if (selectedResource) {
      showToast({
        style: Toast.Style.Success,
        title: "Link captured",
      });
    }
  }, [selectedText, selectedResource]);

  const formattedData = useMemo(() => {
    return ({
      content,
      link,
      highlight,
      pageContent,
    }: {
      content?: string;
      link?: string;
      highlight?: boolean;
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
        data.push(`> ${selectedText}`);
      }
      if (pageContent) {
        data.push(`## Page Content\n\n${pageContent}`);
      }
      return data.join("\n\n");
    };
  }, [resourceInfo, selectedText]);

  async function createNewNote({ fileName: rawFileName, content, link, vault, path, highlight }: Form.Values) {
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
        pageContent: fetchedPageContent,
      });

      const noteFileName = fullFilePath.endsWith(".md") ? fullFilePath : `${fullFilePath}.md`;
      const absolutePath = fsPath.join(vaultObj.path, noteFileName);
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
            <Action.SubmitForm title="Capture" onSubmit={createNewNote} />
            <Action
              title="Clear Capture"
              shortcut={{ modifiers: ["opt"], key: "backspace" }}
              onAction={() => {
                setResourceInfo("");
                setSelectedResource("");
                setSelectedText("");
                setFileName("");
                setAutoTitle("");
                setHasManualTitleOverride(false);
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
          placeholder="Title for the resource"
          value={fileName}
          onChange={(nextValue) => {
            setFileName(nextValue);
            if (!nextValue.trim()) {
              setHasManualTitleOverride(false);
              return;
            }
            setHasManualTitleOverride(nextValue !== autoTitle);
          }}
          autoFocus
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

        {selectedResource && (
          <Form.Checkbox
            id="includePageContent"
            title="Include page content"
            label=""
            value={includePageContent}
            onChange={setIncludePageContent}
          />
        )}

        <Form.TextArea title="Note" id="content" placeholder={"Notes about the resource"} enableMarkdown={true} />

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
