import { describe, expect, it, vi } from "vitest";
import { changeOwnerPassword } from "@/lib/neon/change-password";

describe("password change", () => {
  it("uses the existing client and requests revocation of other sessions", async () => {
    const changePassword = vi.fn(async () => ({error:null}));
    await changeOwnerPassword("current secret", "a-new-test-password", {changePassword});
    expect(changePassword).toHaveBeenCalledWith({currentPassword:"current secret",newPassword:"a-new-test-password",revokeOtherSessions:true});
  });
  it("rejects weak or failed requests without returning provider error details", async () => {
    const changePassword = vi.fn(async () => ({error:{message:"sensitive"}}));
    await expect(changeOwnerPassword("current", "short", {changePassword})).rejects.toThrow("requirements");
    expect(changePassword).not.toHaveBeenCalled();
    await expect(changeOwnerPassword("current", "a-new-test-password", {changePassword})).rejects.toThrow("Password change failed.");
  });
});
