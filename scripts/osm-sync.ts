// 週次 cron と同じ 1 チャンクをローカルから 1 回だけ走らせる。
//   pnpm osm-sync
// 必要な環境変数（.env.local）: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY
// 019_osm_sync.sql を適用済みであること。Overpass に実際に問い合わせる。

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { rpcClientFromSupabase } from "../src/lib/osmSync/db";
import { executeOsmSync } from "../src/lib/osmSync/execute";
import { sanitizeSyncError } from "../src/lib/osmSync/sanitize";

function loadDotenv(path: string) {
  try {
    const text = readFileSync(path, "utf8");
    for (const rawLine of text.split("\n")) {
      const line = rawLine.replace(/\r$/, "");
      const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i);
      if (!match) continue;
      const key = match[1]!;
      let val = match[2]!;
      const doubleQuoted = val.startsWith('"');
      const singleQuoted = val.startsWith("'");
      if (doubleQuoted || singleQuoted) {
        const quote = doubleQuoted ? '"' : "'";
        const end = val.indexOf(quote, 1);
        val = end > 0 ? val.slice(1, end) : val.slice(1);
      } else {
        const commentMatch = val.match(/\s+#.*$/);
        if (commentMatch) val = val.slice(0, commentMatch.index);
        val = val.trim();
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
  } catch {
    // ファイルがなければ無視
  }
}

loadDotenv(resolve(process.cwd(), ".env.local"));

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY を .env.local に設定してください");
    process.exit(1);
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const result = await executeOsmSync(rpcClientFromSupabase(supabase));
  console.log(JSON.stringify(result.body));
  process.exit(result.body.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(sanitizeSyncError(err));
  process.exit(1);
});
