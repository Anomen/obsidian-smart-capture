import fs from "fs";
import path from "path";

const TEMPLATER_SETTINGS_RELATIVE_PATH = [".obsidian", "plugins", "templater-obsidian", "data.json"];

interface TemplaterFolderTemplate {
  folder?: string;
  template?: string;
}

interface TemplaterFileTemplate {
  regex?: string;
  template?: string;
}

interface TemplaterSettings {
  trigger_on_file_creation?: boolean;
  enable_folder_templates?: boolean;
  folder_templates?: TemplaterFolderTemplate[];
  enable_file_templates?: boolean;
  file_templates?: TemplaterFileTemplate[];
}

function normalizeVaultRelativePath(value: string) {
  return value.replace(/\\/g, "/").trim().replace(/^\/+|\/+$/g, "");
}

function stripMarkdownExtension(value: string) {
  return value.replace(/\.md$/i, "");
}

function readTemplaterSettings(vaultPath: string): TemplaterSettings | null {
  const settingsPath = path.join(vaultPath, ...TEMPLATER_SETTINGS_RELATIVE_PATH);
  if (!fs.existsSync(settingsPath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(settingsPath, "utf8")) as TemplaterSettings;
  } catch (_error) {
    return null;
  }
}

function findMatchingFileTemplate(
  noteRelativePath: string,
  fileTemplates: TemplaterFileTemplate[] | undefined
): string | null {
  const candidates = [noteRelativePath, stripMarkdownExtension(noteRelativePath)];

  for (const fileTemplate of fileTemplates || []) {
    if (!fileTemplate.regex || !fileTemplate.template) {
      continue;
    }

    try {
      const pattern = new RegExp(fileTemplate.regex);
      if (candidates.some((candidate) => pattern.test(candidate))) {
        return normalizeVaultRelativePath(fileTemplate.template);
      }
    } catch (_error) {
      continue;
    }
  }

  return null;
}

function findMatchingFolderTemplate(
  noteRelativePath: string,
  folderTemplates: TemplaterFolderTemplate[] | undefined
): string | null {
  const noteFolder = normalizeVaultRelativePath(path.posix.dirname(noteRelativePath)).replace(/^\.$/, "");
  let matchedTemplate: string | null = null;
  let matchedDepth = -1;

  for (const folderTemplate of folderTemplates || []) {
    if (!folderTemplate.folder || !folderTemplate.template) {
      continue;
    }

    const rawFolder = folderTemplate.folder.replace(/\\/g, "/").trim();
    const normalizedFolder = normalizeVaultRelativePath(rawFolder);
    const isCatchAll = rawFolder === "/";
    const isMatch =
      isCatchAll ||
      normalizedFolder === noteFolder ||
      (normalizedFolder !== "" && noteFolder.startsWith(`${normalizedFolder}/`));

    if (!isMatch) {
      continue;
    }

    const depth = isCatchAll ? 0 : normalizedFolder.split("/").length;
    if (depth > matchedDepth) {
      matchedTemplate = normalizeVaultRelativePath(folderTemplate.template);
      matchedDepth = depth;
    }
  }

  return matchedTemplate;
}

export function findMatchingTemplaterTemplate(noteRelativePath: string, settings: TemplaterSettings): string | null {
  if (!settings.trigger_on_file_creation) {
    return null;
  }

  const normalizedNotePath = normalizeVaultRelativePath(noteRelativePath);
  if (!normalizedNotePath) {
    return null;
  }

  if (settings.enable_file_templates) {
    return findMatchingFileTemplate(normalizedNotePath, settings.file_templates);
  }

  if (settings.enable_folder_templates) {
    return findMatchingFolderTemplate(normalizedNotePath, settings.folder_templates);
  }

  return null;
}

function readTemplateFile(vaultPath: string, templateRelativePath: string) {
  const normalizedTemplatePath = normalizeVaultRelativePath(templateRelativePath);
  const candidatePaths = normalizedTemplatePath.endsWith(".md")
    ? [normalizedTemplatePath]
    : [normalizedTemplatePath, `${normalizedTemplatePath}.md`];

  for (const candidatePath of candidatePaths) {
    const absoluteTemplatePath = path.join(vaultPath, ...candidatePath.split("/"));
    if (fs.existsSync(absoluteTemplatePath)) {
      return fs.readFileSync(absoluteTemplatePath, "utf8");
    }
  }

  return null;
}

export function getTemplaterTemplateContentForNote(vaultPath: string, noteRelativePath: string): string | null {
  const settings = readTemplaterSettings(vaultPath);
  if (!settings) {
    return null;
  }

  const templateRelativePath = findMatchingTemplaterTemplate(noteRelativePath, settings);
  if (!templateRelativePath) {
    return null;
  }

  return readTemplateFile(vaultPath, templateRelativePath);
}

export function mergeTemplateWithCapturedContent(templateContent: string | null, capturedContent: string) {
  const trimmedTemplate = (templateContent || "").trimEnd();
  const trimmedCapturedContent = capturedContent.trim();

  if (!trimmedTemplate) {
    return trimmedCapturedContent;
  }

  if (!trimmedCapturedContent) {
    return `${trimmedTemplate}\n`;
  }

  return `${trimmedTemplate}\n\n${trimmedCapturedContent}`;
}
