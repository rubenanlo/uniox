/**
 * The name Gmail itself puts on this account's outgoing mail: the default
 * send-as display name when the user configured one, else the OAuth profile
 * name (present once the `profile` scope was granted). Null when neither is
 * available — callers keep whatever displayName they had.
 */
export async function fetchGoogleSenderName(token: string): Promise<string | null> {
  const get = async (url: string): Promise<Record<string, unknown> | null> => {
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      return res.ok ? ((await res.json()) as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };
  const sendAs = (await get('https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs')) as {
    sendAs?: { isDefault?: boolean; isPrimary?: boolean; displayName?: string }[];
  } | null;
  const entry =
    sendAs?.sendAs?.find((s) => s.isDefault) ?? sendAs?.sendAs?.find((s) => s.isPrimary);
  if (entry?.displayName?.trim()) return entry.displayName.trim();
  const info = (await get('https://www.googleapis.com/oauth2/v3/userinfo')) as {
    name?: string;
  } | null;
  return info?.name?.trim() || null;
}
