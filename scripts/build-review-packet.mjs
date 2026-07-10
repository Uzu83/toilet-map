#!/usr/bin/env node
// ============================================================================
// build-review-packet.mjs — 機械可読成果物を人間向け承認票に束ねる
// （/dev-secure scope:gate が scripts/ に配置。zero-dep / Node 18+）
//
// 役割: 「人間はソースコードを読まず、リスク承認票だけを見る」運用の最終段。
//   artifacts/ 配下の JUnit / Trivy JSON / gitleaks SARIF / SBOM /
//   review-adjudication.json を集計し、
//   - artifacts/audit/risk-gate.json          （機械可読・監査ログ）
//   - artifacts/audit/release-decision-packet.md（人間が読む唯一の文書）
//   を生成する。
//
// 設計原則 fail-closed:
//   必須成果物が欠けている場合は「不明=安全」ではなく「不明=ブロック」。
//   欠損を許すと「スキャンを走らせないほうが通りやすい」という
//   逆インセンティブが生まれるため。ここを緩めてはいけない。
//
// このスクリプト自身は新しい分析をしない（集約のみ）。分析ロジックを
// ここに足すと「ゲートがゲート自身を採点する」構図になるので禁止。
// ============================================================================
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";

const OUT_DIR = "artifacts/audit";
mkdirSync(OUT_DIR, { recursive: true });

const readIf = (p) => (existsSync(p) ? readFileSync(p, "utf8") : null);
const sh = (cmd) => {
  try {
    return execSync(cmd, { encoding: "utf8" }).trim();
  } catch {
    return "(unavailable)";
  }
};

const blockers = [];   // severity 無関係の絶対ブロック理由
const missing = [];    // 欠損した必須成果物（= それ自体がブロック理由）

// --- 1. テスト結果 (JUnit XML) ------------------------------------------------
// XML パーサを入れない理由: testsuite 要素の属性集計だけなら正規表現で足り、
// 依存追加 = lock 変更 = 合意ゲート対象という摩擦のほうが大きい。
let test = { suites: 0, tests: 0, failures: 0, errors: 0 };
const testDir = "artifacts/test";
if (existsSync(testDir)) {
  for (const f of readdirSync(testDir).filter((f) => f.endsWith(".xml"))) {
    const xml = readFileSync(`${testDir}/${f}`, "utf8");
    for (const m of xml.matchAll(/<testsuite\b[^>]*/g)) {
      const attr = (name) => Number((m[0].match(new RegExp(`${name}="(\\d+)"`)) ?? [])[1] ?? 0);
      test.suites += 1;
      test.tests += attr("tests");
      test.failures += attr("failures");
      test.errors += attr("errors");
    }
  }
}
if (test.suites === 0) missing.push("テスト結果 (artifacts/test/*.xml)");
if (test.failures + test.errors > 0)
  blockers.push(`テスト失敗 ${test.failures + test.errors} 件`);

// --- 2. 脆弱性 (Trivy JSON) ---------------------------------------------------
let vulns = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0 };
let secretsFromTrivy = 0;
const trivyRaw = readIf("artifacts/sca/trivy-fs.json");
if (trivyRaw) {
  const trivy = JSON.parse(trivyRaw);
  for (const result of trivy.Results ?? []) {
    for (const v of result.Vulnerabilities ?? [])
      vulns[v.Severity ?? "UNKNOWN"] = (vulns[v.Severity ?? "UNKNOWN"] ?? 0) + 1;
    secretsFromTrivy += (result.Secrets ?? []).length;
  }
} else {
  missing.push("Trivy スキャン結果 (artifacts/sca/trivy-fs.json)");
}
if (vulns.CRITICAL > 0) blockers.push(`CRITICAL 脆弱性 ${vulns.CRITICAL} 件`);

// --- 3. Secret (gitleaks SARIF + Trivy secrets) --------------------------------
// CI はリポジトリ直下、ローカル security-scan.sh は artifacts/secret/ に吐くため両方見る。
// 【break を戻さないこと — Chess-Japan の Codex ゲート② F001 と統合】最初に見つかった
// SARIF で break すると、古い clean な artifacts/secret/gitleaks.sarif が残ったまま root 側に
// 検出入り SARIF がある場合に root が無視され、絶対ブロックが発火しない fail-open になる。
// secret は絶対ブロック条件なので両パスを break せず全合算する（同一検出の二重計上は
// 起きうるが、判定は secretCount>0 の閾値なので過大計上は安全側＝fail-safe。de-dup の
// 複雑さより単純さを取る）。gitleaksFound は「どれか1つでも SARIF を読めたか」を追跡し、
// 下の fail-closed 判定（SARIF が皆無なら missing 計上）に使う。両者で (a)SARIF 皆無 と
// (b)stale-clean を先に読んで検出を握り潰す の 2 つの fail-open を同時に塞ぐ。
let secretCount = secretsFromTrivy;
let gitleaksFound = false;
for (const p of ["artifacts/secret/gitleaks.sarif", "gitleaks.sarif"]) {
  const raw = readIf(p);
  if (raw) {
    const sarif = JSON.parse(raw);
    for (const run of sarif.runs ?? []) secretCount += (run.results ?? []).length;
    gitleaksFound = true;
  }
}
// fail-closed: gitleaks SARIF が無ければ「secret 0 件」ではなく「欠損」扱いにする。
// WHY（Codex Gate-2 指摘・採用）: Trivy fs の secret 検出はワーキングツリーのみで、
// security.yml が別途走らせる gitleaks の「履歴込み」スキャンの代替にはならない。
// gitleaks 成果物を落としたまま packet を組むと secretCount が Trivy 分だけになり
// 「Secret 検出: 0 件」で approvable になりうる — このゲートの存在意義（secret は
// 絶対ブロック）を自ら裏切る fail-open。test/Trivy/SBOM/裁定 が不在で missing に
// 積むのと同じく、gitleaks 不在も必ず missing に積んで blocked を強制する。
if (!gitleaksFound) missing.push("Gitleaks secret スキャン (gitleaks.sarif)");
if (secretCount > 0) blockers.push(`Secret 検出 ${secretCount} 件（絶対ブロック）`);

// --- 4. SBOM -------------------------------------------------------------------
const sbomOk = existsSync("artifacts/sbom/repo.cdx.json");
if (!sbomOk) missing.push("SBOM (artifacts/sbom/repo.cdx.json)");

// --- 5. Codex レビュー裁定 ------------------------------------------------------
let adjudication = null;
const adjRaw = readIf("artifacts/review/review-adjudication.json");
if (adjRaw) {
  adjudication = JSON.parse(adjRaw);
  const counts = { accept: 0, reject: 0, defer: 0 };
  for (const item of adjudication.items ?? []) counts[item.status] = (counts[item.status] ?? 0) + 1;
  adjudication._counts = counts;
  // accept されたまま修正されていない critical/high はブロック。
  // （裁定 JSON は「修正完了後」に再生成される運用なので、残存 accept = 未修正）
  const openHigh = (adjudication.items ?? []).filter(
    (i) => i.status === "accept" && /critical|high/i.test(i.reason + " " + (i.next_action ?? ""))
  );
  if (["high", "critical"].includes(adjudication.risk_level) && counts.accept > 0)
    blockers.push(`Codex 裁定に未解消の accept ${counts.accept} 件（risk_level: ${adjudication.risk_level}）`);
  void openHigh;
} else {
  missing.push("レビュー裁定 (artifacts/review/review-adjudication.json)");
}

// --- 判定（fail-closed: 欠損もブロック） ------------------------------------------
const blocked = blockers.length > 0 || missing.length > 0;
const gate = {
  generated_at: new Date().toISOString(),
  git_head: sh("git rev-parse HEAD"),
  branch: sh("git rev-parse --abbrev-ref HEAD"),
  verdict: blocked ? "blocked" : "approvable",
  blockers,
  missing_artifacts: missing,
  test,
  vulnerabilities: vulns,
  secret_findings: secretCount,
  sbom_present: sbomOk,
  adjudication_counts: adjudication?._counts ?? null,
  adjudication_risk_level: adjudication?.risk_level ?? null,
};
writeFileSync(`${OUT_DIR}/risk-gate.json`, JSON.stringify(gate, null, 2) + "\n");

// --- 人間向け packet ------------------------------------------------------------
const fmt = (v) => (v === null || v === undefined ? "未取得" : v);
const md = `# Release Decision Packet

> これは人間が読む**唯一**の承認文書。コード本文・生ログはここに含めない。
> 生成: ${gate.generated_at} / branch: \`${gate.branch}\` / commit: \`${gate.git_head}\`

## 判定: ${blocked ? "🚫 ブロック" : "✅ 承認可能"}

${blockers.length ? "### ブロック理由\n" + blockers.map((b) => `- ${b}`).join("\n") : ""}
${missing.length ? "### 欠損している必須成果物（欠損=ブロック / fail-closed）\n" + missing.map((m) => `- ${m}`).join("\n") : ""}

## 変更要約
${fmt(adjudication?.summary)}

## テスト
| suites | tests | failures | errors |
|---:|---:|---:|---:|
| ${test.suites} | ${test.tests} | ${test.failures} | ${test.errors} |

## 脆弱性（Trivy）
| CRITICAL | HIGH | MEDIUM | LOW |
|---:|---:|---:|---:|
| ${vulns.CRITICAL} | ${vulns.HIGH} | ${vulns.MEDIUM} | ${vulns.LOW} |

## Secret 検出: ${secretCount} 件

## Codex レビュー裁定
- リスクレベル: ${fmt(adjudication?.risk_level)}
- accept: ${fmt(adjudication?._counts?.accept)} / reject: ${fmt(adjudication?._counts?.reject)} / defer: ${fmt(adjudication?._counts?.defer)}

## SBOM: ${sbomOk ? "生成済み (artifacts/sbom/repo.cdx.json)" : "未生成（ブロック）"}

---

## 承認欄（人間が記入）
- [ ] 承認する（上記リスクを受け入れる）
- [ ] 却下する（理由: ______________）
- 例外承認（waiver）を出す場合は**期限必須**: ____-__-__ まで
`;
writeFileSync(`${OUT_DIR}/release-decision-packet.md`, md);

console.log(`verdict: ${gate.verdict}`);
console.log(`- ${OUT_DIR}/risk-gate.json`);
console.log(`- ${OUT_DIR}/release-decision-packet.md`);
// ブロック時は非ゼロ終了 = CI やスクリプト連鎖でそのままゲートとして使える
process.exit(blocked ? 1 : 0);
