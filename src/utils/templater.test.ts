import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  findMatchingTemplaterTemplate,
  getTemplaterTemplateContentForNote,
  mergeTemplateWithCapturedContent,
} from "./templater";

const tempDirs: string[] = [];

function createTempVault() {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "templater-vault-"));
  tempDirs.push(vaultPath);
  return vaultPath;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

describe("templater utils", () => {
  it("matches the first file regex template", () => {
    const settings = {
      trigger_on_file_creation: true,
      enable_file_templates: true,
      file_templates: [
        { regex: "Inbox/.*", template: "Templates/Inbox.md" },
        { regex: ".*", template: "Templates/Generic.md" },
      ],
    };

    expect(findMatchingTemplaterTemplate("Inbox/Capture.md", settings)).toBe("Templates/Inbox.md");
  });

  it("matches file templates when regexes omit the markdown extension", () => {
    const settings = {
      trigger_on_file_creation: true,
      enable_file_templates: true,
      file_templates: [{ regex: "Journal/[^/]+$", template: "Templates/Daily.md" }],
    };

    expect(findMatchingTemplaterTemplate("Journal/2026-03-16.md", settings)).toBe("Templates/Daily.md");
  });

  it("matches the deepest folder template", () => {
    const settings = {
      trigger_on_file_creation: true,
      enable_folder_templates: true,
      folder_templates: [
        { folder: "/", template: "Templates/Generic.md" },
        { folder: "Projects", template: "Templates/Project.md" },
        { folder: "Projects/Client", template: "Templates/Client.md" },
      ],
    };

    expect(findMatchingTemplaterTemplate("Projects/Client/Brief.md", settings)).toBe("Templates/Client.md");
  });

  it("skips matching when templater auto-run is disabled", () => {
    const settings = {
      trigger_on_file_creation: false,
      enable_file_templates: true,
      file_templates: [{ regex: ".*", template: "Templates/Generic.md" }],
    };

    expect(findMatchingTemplaterTemplate("Inbox/Capture.md", settings)).toBeNull();
  });

  it("loads the matching template content from a vault", () => {
    const vaultPath = createTempVault();

    fs.mkdirSync(path.join(vaultPath, ".obsidian", "plugins", "templater-obsidian"), { recursive: true });
    fs.mkdirSync(path.join(vaultPath, "Templates"), { recursive: true });

    fs.writeFileSync(
      path.join(vaultPath, ".obsidian", "plugins", "templater-obsidian", "data.json"),
      JSON.stringify({
        trigger_on_file_creation: true,
        enable_file_templates: true,
        file_templates: [{ regex: ".*", template: "Templates/Generic Note.md" }],
      }),
      "utf8"
    );
    fs.writeFileSync(path.join(vaultPath, "Templates", "Generic Note.md"), "# Template\nBody\n", "utf8");

    expect(getTemplaterTemplateContentForNote(vaultPath, "Inbox/Capture.md")).toBe("# Template\nBody\n");
  });

  it("merges template content ahead of captured content", () => {
    expect(mergeTemplateWithCapturedContent("# Template\n", "Captured body")).toBe("# Template\n\nCaptured body");
    expect(mergeTemplateWithCapturedContent("# Template\n", "")).toBe("# Template\n");
  });
});
