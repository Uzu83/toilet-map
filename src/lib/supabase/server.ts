import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _publishableServer: SupabaseClient | null = null;
let _secretServer: SupabaseClient | null = null;

export function getServerSupabasePublishable(): SupabaseClient {
  if (_publishableServer) return _publishableServer;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY 未設定");
  }
  _publishableServer = createClient(url, publishableKey, { auth: { persistSession: false } });
  return _publishableServer;
}

export function getServerSupabaseSecret(): SupabaseClient {
  if (_secretServer) return _secretServer;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY 未設定");
  }
  _secretServer = createClient(url, secretKey, {
    auth: { persistSession: false },
  });
  return _secretServer;
}
