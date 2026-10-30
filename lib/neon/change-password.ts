import { getNeon } from "./client";

type PasswordClient = { changePassword(input: { currentPassword:string; newPassword:string; revokeOtherSessions:boolean }): Promise<{ error:unknown }> };
/** Use the installed Neon adapter's Better Auth client and current session. */
export async function changeOwnerPassword(currentPassword: string, newPassword: string, client?: PasswordClient): Promise<void> {
  if (!currentPassword || newPassword.length < 12) throw new Error("Password requirements not met.");
  const adapter = client ? null : getNeon().auth as unknown as { getBetterAuthInstance(): PasswordClient };
  const result = await (client ?? adapter!.getBetterAuthInstance()).changePassword({ currentPassword, newPassword, revokeOtherSessions:true });
  if (result.error) throw new Error("Password change failed.");
}
