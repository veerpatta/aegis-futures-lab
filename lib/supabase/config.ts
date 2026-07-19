/* Supabase project coordinates. The publishable key is designed to ship in
   client code (row access is governed by RLS policies, not by this key);
   env vars override it for a different project or a rotated key. */

export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://bizgcoljagsnytrnaicr.supabase.co";

export const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_KEY || "sb_publishable_4AAYYUppP6lRdoofTTkd_A_YSu6WPNo";
