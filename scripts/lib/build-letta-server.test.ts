import { describe, expect, it } from "vitest";
import {
  getBundledServerPrunePlan,
  getBundledServerPackagingProfiles,
  getDefaultBundledServerProfileName,
  resolveBundledServerPackagingProfile,
} from "../build-letta-server.mjs";

describe("build-letta-server packaging profiles", () => {
  it("defaults to telegram-lite", () => {
    expect(getDefaultBundledServerProfileName()).toBe("telegram-lite");
    expect(resolveBundledServerPackagingProfile("telegram-lite").name).toBe("telegram-lite");
  });

  it("exposes the slim pruning plan for telegram-lite", () => {
    const prunePlan = getBundledServerPrunePlan("telegram-lite");

    expect(prunePlan.profileName).toBe("telegram-lite");
    expect(prunePlan.removableSitePackages).toContain("pip");
    expect(prunePlan.removableSitePackages).toContain("temporalio");
    expect(prunePlan.removablePythonBasePaths).toContain("lib/python3.11/ensurepip");
    expect(prunePlan.maxServerSizeMb).toBe(475);
  });

  it("keeps optional packages in the full profile", () => {
    const prunePlan = getBundledServerPrunePlan("full");

    expect(prunePlan.profileName).toBe("full");
    expect(prunePlan.removableSitePackages).toContain("pip");
    expect(prunePlan.removableSitePackages).not.toContain("temporalio");
    expect(prunePlan.maxServerSizeMb).toBeNull();
  });

  it("reports supported packaging profiles", () => {
    expect(getBundledServerPackagingProfiles()).toEqual({
      "telegram-lite": {
        description: expect.any(String),
        maxServerSizeMb: 475,
      },
      full: {
        description: expect.any(String),
        maxServerSizeMb: null,
      },
    });
  });

  it("rejects unsupported profiles", () => {
    expect(() => resolveBundledServerPackagingProfile("unknown-profile")).toThrow(/Unsupported LETTA_SERVER_PROFILE/);
  });
});
