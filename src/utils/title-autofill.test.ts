import { describe, expect, it } from "vitest";
import { resolveAutoTitle, shouldApplyAutoTitle } from "./title-autofill";

describe("title autofill", () => {
  it("resolves auto title from resource info", () => {
    expect(resolveAutoTitle(" Personal / CLI | Raycast API ")).toBe("Personal - CLI - Raycast API");
  });

  it("applies auto title when no manual override exists", () => {
    expect(shouldApplyAutoTitle("", "Auto Title", false)).toBe(true);
  });

  it("applies auto title when field is cleared", () => {
    expect(shouldApplyAutoTitle("", "Auto Title", true)).toBe(true);
  });

  it("applies auto title when current title still matches previous auto title", () => {
    expect(shouldApplyAutoTitle("Auto Title", "Auto Title", true)).toBe(true);
  });

  it("does not apply auto title after manual override", () => {
    expect(shouldApplyAutoTitle("Custom Title", "Auto Title", true)).toBe(false);
  });
});
