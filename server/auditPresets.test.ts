import { describe, expect, it } from "vitest";
import { isAuditPresetId } from "./auditPresets";

describe("audit presets", () => {
  it("accepts the useful skills preset id", () => {
    expect(isAuditPresetId("useful-skills")).toBe(true);
  });

  it("rejects unknown preset ids", () => {
    expect(isAuditPresetId("skills")).toBe(false);
  });
});
