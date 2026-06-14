# Issue #1 設計書 — 未レビュートイレの段階的 indexable 化

> `/dev-init 1` 生成。Notion 概要ページにも反映。最終 % / 閾値は Step5 Codex レビューと実測で確定。

## 1. 背景 / 問題

起点コミット `83e63ee perf(seo/cost)`:

- programmatic-SEO で ~80k トイレ × 4 locale の ISR ページを sitemap で全公開 → クローラ churn で **ISR Writes 806K / 200K (Hobby)** 突破。
- 対症療法: `/toilet/[id]` revalidate 1h→**30d**、`/area/[region]` 6h→**7d**、`isToiletIndexable(t)=review_count>0` で未レビューを noindex,follow + sitemap 非掲載、`sitemapChunkCount()` を常に 1 に固定。

副作用 = **鶏卵問題**: 検索流入なし→レビュー付かない→永遠に noindex。~80k のうち SEO 入口になり得るのはごく一部。

## 2. ゴール / 受入条件 (Issue より)

- [ ] AC1: `isToiletIndexable(t)` に `review_count` 以外の品質シグナルを追加し、indexable 件数を意図レンジに収める。
- [ ] AC2: 追加後の sitemap 行数を試算し ISR Writes 月予算 (Hobby 200K/月) 想定内であることを README または PROGRESS に記録。
- [ ] AC3: `sitemapChunkCount()` 閾値を更新する場合は根拠を含める。
- [ ] AC4: 既存の**公開対象トイレ（`review_count > 0` かつ `not_a_toilet_count < 5`）**が indexable / sitemap から落ちないこと（退行なし）。`not_a_toilet_count >= 5` のページは現状も `/toilet/[id]` が `notFound()` で弾くため AC4 の保護対象外（[Step5-P0]）。

**非スコープ (Phase 2+)**: 認証付き投稿フロー / AdSense 配信最適化 / 新規ピン追加 UI。

## 3. 採用方針 (人間判断: 2026-06-14)

**signal = named OSM + review維持**:

```
indexable(t) ⇔  not_a_toilet_count < 5
            AND ( review_count > 0                              -- 既存維持 (AC4)
                  OR ( source = 'osm'
                       AND named(t) ) )                         -- 追加シグナル

named(t) := name の正規化非空。SQL = (name IS NOT NULL AND name ~ '[^[:space:]]')
                                  TS  = (name?.trim().length ?? 0) > 0   // §5.1 の正規化注記参照
```

> **正規化の単一の真実**: `named(t)` の定義は §5 を canonical とし、SQL（migration 007）と TS（`isToiletIndexable`）は必ずこの定義に一致させる。空白のみ名 (`"   "`) は **非 named**（落とす）。

採用理由:
- `source='osm'` かつ `name` 有り = 実在トイレで名称あり → 「名前 + amenity タグ + 地図リンク」より情報量が多く thin-content リスクが低い。
- `source='inferred'` (駅/モール等) は **除外**: 実物トイレが特定できない UX 問題がある。加えて**個別 SEO ページの** `isToiletUnconfirmed(t)`（`src/lib/toiletSeo.ts`）が `source==='inferred'` を「未確認」扱いにしており、index 化と矛盾する（※型側の `isUnconfirmed`（`src/types/toilet.ts`）は `review_count < 10` のみで source を見ない。両者を混同しない）。
- リッチ条件 (amenity/opening_hours 必須) はオプションの絞り込み弁として保持 (件数が予算超過しそうなら追加適用)。

## 4. 重要な前提 — ISR Writes 予算モデル

### 4.1 30日 revalidate がゲームを変える

`/toilet/[id]` は既に `revalidate = 2592000` (30日)。よって **1 ページ (1 locale) が生む ISR Write は、キャッシュ失効後の再クロール 1 回につき最大 1 回 / 30日**。806K の暴発は旧 1h revalidate × 大量クロールが原因で、現状はこの構造的歯止めが効いている。

### 4.2 試算式 (パラメトリック)

```
月間 ISR Writes(toilet) ≈ N_indexable × L × max( D , month / revalidate_cap )
  N_indexable     : indexable なトイレ件数 (実測で確定 — Task 1.1)
  L               : ロケール数 = 4
  D               : 月間デプロイ回数 (デプロイが ISR キャッシュを無効化する場合の係数)
  month/revalidate_cap = 2,592,000 / 2,592,000 ≈ 1  (30日 revalidate)
```

⚠️ **要公式確認 (執筆時点の理解)**: Vercel で「新規デプロイが on-demand ISR キャッシュを無効化するか」は挙動が版・設定依存。設計では保守的に **D で乗算される最悪ケース**と、**無効化されない (≈ N×L×1) 楽観ケース**の両端を提示し、実運用で Vercel Usage ダッシュボードで実測する (Task 3.x)。Vercel 公式ドキュメント要確認。

### 4.3 予算上限から逆算 (toilet 分のみ。area/static 分の余裕を残す)

200K/月を toilet ページが食い切らない目安 (例: toilet に 120K まで):

| デプロイ前提 D | 許容 N_indexable (= 120,000 / (4×D)) |
|---|---|
| D=1 (デプロイ無効化なし相当) | ~30,000 |
| D=2 | ~15,000 |
| D=4 | ~7,500 |

→ **named OSM の実測件数 (osm ~31k の名称あり部分集合) と運用デプロイ頻度**で安全圏が決まる。実測 N がデプロイ前提に対し超過するなら §3 のリッチ条件を追加適用して N を圧縮する。

### 4.4 sitemap 行数と固定 ISR 分（AC2 の証跡項目 — [Step5-P1]）

AC2 は「sitemap 行数試算 + ISR 予算内」を要求。記録すべき項目を toilet 個別ページだけに寄せず、全体を明示する:

```
sitemap URL rows = static_rows + area_rows + (N_indexable × L)
  static_rows = 5 paths × 4 locale = 20            (チャンク0、hreflang 付き)
  area_rows   = |areaSlugs| × 4 locale             (チャンク0、hreflang 付き)
  toilet_rows = N_indexable × 4                     (チャンク1.., hreflang 省略)

chunk_count = 1 + ceil(N_indexable / 11,000)        (§6.5、indexableCount=0 でも 1)
```

**固定 ISR 分（クロール件数に依らず発生する再生成）**:
- `sitemap.ts`: `revalidate = 86400`（日次）。チャンク数ぶんの sitemap ルートが日次再生成 = `chunk_count × ~30 writes/月`（軽微）。
- `/area/[region]`: `revalidate = 604800`（7日）。area ページの再生成 = `area_pages × ~4 writes/月`（既存・本 Issue で増えない）。
- `/toilet/[id]`: `revalidate = 2592000`（30日）。§4.2 の `N_indexable × L × max(D, 1)` が支配項。

→ AC2 記録は「**toilet 個別ページ分（120K 枠）＋ sitemap/area の固定 ISR 分**」をまとめて PROGRESS/README に残す（個別ページ分だけだと証跡として不足）。

## 5. 二重ゲート問題 (TS / SQL の整合)

ゲートは 2 箇所で評価される。**ロジックを必ず一致させる**:

| 箇所 | 形態 | 用途 |
|---|---|---|
| `src/lib/toiletSeo.ts` `isToiletIndexable(t)` | TS (Toilet 1件) | `/toilet/[id]` の `robots.index` |
| 新 migration 007 の RPC | SQL (WHERE 述語) | sitemap が indexable 部分集合だけを列挙 |

migration 006 は速度のため `toilet_ids_page` から `toilet_stats` join を**外した**。`review_count>0` を述語に含めるには join 再導入が必要 → 新 RPC で対応 + 適切な index。`name`/`source` 述語は `toilets` 本体カラムのみで済む (join 不要部分)。

### 5.1 正規化ルール（canonical predicate — [Step5-P1]）

ズレ防止のため、述語を 1 つの定義に固定する。SQL / TS はこれを実装するだけ:

```
INDEXABLE(t) :=
     not_a_toilet_count < 5
  AND ( review_count > 0
        OR ( source = 'osm' AND NAMED(t) ) )

NAMED(t) := name に「空白以外の文字」が 1 つ以上ある
  SQL: (t.name IS NOT NULL AND t.name ~ '[^[:space:]]')
  TS : ((t.name?.trim().length ?? 0) > 0)     // 空白のみ → false
```

> ⚠️ **正規化の落とし穴（Step8-P1）**: JS `trim()` は Unicode 空白（タブ `\t`・改行 `\n`・全角スペース `U+3000` 等）を除去するが、SQL の `btrim(name)`（引数なし）は **ASCII 半角スペースのみ**。両者一致のため SQL は `btrim(name)<>''` ではなく **POSIX `[:space:]` クラスを使う `name ~ '[^[:space:]]'`** とする（タブ・改行・半角スペースを空白扱い）。全角スペース `U+3000` を `[:space:]` が拾うかは DB locale/encoding 依存のため §5.2 の T9 で実値確認する。部分 index の述語も同じ正規化式に揃える。

- `review_count` は SQL では `coalesce(s.review_count,0)`（`toilet_stats` join、005 と同形）。
- `not_a_toilet_count` も `coalesce(s.not_a_toilet_count,0)`。
- TS（`isToiletIndexable`）は `Toilet` 1件に対する純関数として残す（page.tsx の `robots.index` 用）。完全な 1 箇所計算は不可（SQL は集合、TS は単件）だが、**同一の真理値表**を満たすことを fixture テストで固定する。

### 5.2 真理値表（回帰・同値テストの最小セット）

| ケース | source | name | review | not_a_toilet | INDEXABLE |
|---|---|---|---|---|---|
| 既存レビュー済（退行 NG） | inferred | null | 3 | 0 | ✅ true |
| レビュー済だが要除外 | osm | "X" | 2 | 5 | ❌ false |
| 新シグナル該当 | osm | "博多駅前" | 0 | 0 | ✅ true |
| 空白のみ名（落とす） | osm | "   " | 0 | 0 | ❌ false |
| 無名 OSM（落とす） | osm | null | 0 | 0 | ❌ false |
| user 投稿・無名（対象外） | user | null | 0 | 0 | ❌ false |
| inferred・未レビュー（除外） | inferred | "○○モール" | 0 | 0 | ❌ false |
| not_a_toilet 境界直前 | osm | "X" | 0 | 4 | ✅ true |
| 空白名（タブ等） | osm | "\t" | 0 | 0 | ❌ false |

→ TS 純関数と SQL RPC の両方をこの表で検証（fixture 共有）。R1 の「突き合わせテスト」を本表で具体化。`not_a_toilet_count` は `< 5` が閾値なので、`=4`（通す）と `=5`（落とす, 表 2 行目）の両側を固定する。最終行（タブ名）は §5.1 の trim/btrim 差分（Step8-P1）を固定する回帰。全角スペース `"　"` も同値対象にするか SQL 実値で確認。

## 6. 実装方針 (段階)

1. **実測 (gate)**: prod Supabase で total / osm / inferred / named_osm / named_osm_rich / reviewed / not_a_toilet 件数を取得 → N_indexable と必要チャンク数を確定。
2. **TS ゲート更新**: `isToiletIndexable` に §3 の条件を追加 (review_count>0 を OR の第一項に残す = AC4)。`isToiletUnconfirmed` は据え置き (UI の「未確認」表示は別軸)。
3. **migration 007 (新規)**: `toilet_ids_indexable_page(p_offset,p_limit)` + `toilet_indexable_count()` を `CREATE OR REPLACE` で追加。WHERE は §3 と一致。`not_a_toilet_count<5` も含める。必要 index 追加 (`source`/`name` 部分インデックス検討)。既存ファイルは書き換えない (新ファイル方針)。
4. **`src/lib/toilets.ts`**: sitemap 用に新 RPC を呼ぶ `getIndexableToiletIdsPage()` / `getIndexableToiletCount()` を追加 (PostgREST 1000行ページング踏襲)。`getToiletIdsPage`/`getToiletCount` は他用途があるか確認の上、sitemap 経路のみ差し替え。
5. **`src/lib/sitemapChunks.ts`**: `sitemapChunkCount()` を動的化 = `1 + ceil(indexableCount / SITEMAP_CHUNK_TOILETS)`。`SITEMAP_CHUNK_TOILETS=11,000` は据置 (根拠: Google 上限 50,000 / 4 locale = 12,500、余裕を見て 11,000)。AC3 の根拠として記録。**境界条件**: `indexableCount=0` でも戻り値は 1（チャンク0=静的+area は常に存在）。`ceil(0/11000)=0` なので `1+0=1`、意図どおり（[Step5-P2]）。
6. **`src/app/sitemap.ts`**: id>=1 ブランチを復活させ indexable トイレ URL を列挙 (新 RPC 経由)。`robots.ts` は `sitemapChunkCount()` 共有なので自動追従。
7. **予算記録**: §4 の式 + 実測 N + 採用閾値 + 想定月間 Writes を README または PROGRESS に明記 (AC2)。
8. **(条件付き) revalidate 据置確認**: 30d を維持 (短縮しない)。必要なら toilet を更に延長検討。

## 7. リスク / 退行ポイント

- **R1 (退行)**: SQL 述語が TS と不一致だと、index されるが sitemap 外 / sitemap にあるが noindex の不整合。→ 述語を 1 箇所にドキュメント化し両方を突き合わせるテスト。
- **R2 (予算)**: named OSM が想定超で N×L×D が 200K 超。→ リッチ条件 (§3) でゲート、または revalidate 延長で D の影響圧縮。
- **R3 (退行/AC4)**: `review_count>0` が OR から漏れる実装ミス。→ 回帰テストを 2 ケースに分割（§5.2 の真理値表）: ①`reviewed + unnamed + inferred + not_a_toilet=0` は **indexable のまま**（保護対象）/ ②`reviewed + not_a_toilet=5` は **false**（保護対象外＝現状も notFound）。両者を取り違えない。
- **R4 (build 時確定)**: `generateSitemaps` はビルド時にチャンク数確定。大規模シード後は再デプロイ必要 (既知挙動、PROGRESS に注記)。
- **R5 (perf)**: join 再導入で sitemap RPC が重くなる。→ index + daily revalidate キャッシュで緩和。

## 8. 影響ファイル一覧

| パス | 種別 | 変更 |
|---|---|---|
| `src/lib/toiletSeo.ts` | 直接 | `isToiletIndexable` 条件追加 |
| `supabase/migrations/007_*.sql` | 新規 | indexable RPC + index |
| `src/lib/toilets.ts` | 直接 | indexable 用サーバ関数追加 |
| `src/lib/sitemapChunks.ts` | 直接 | `sitemapChunkCount` 動的化 |
| `src/app/sitemap.ts` | 直接 | id>=1 トイレチャンク復活 |
| `src/app/robots.ts` | 影響 | 共有関数経由で自動追従 (確認のみ) |
| `src/app/[locale]/toilet/[id]/page.tsx` | 影響 | `isToiletIndexable` 経由で robots 自動変化 (確認のみ) |
| `README.md` / `docs/progress/PROGRESS-1.md` | 直接 | 予算試算記録 (AC2) |
| `messages/{ja,en,ko,zh}.json` | 影響なし見込み | バックエンドゲートのため新規 UI 文言なし (要確認) |

## 9. Step 5 Codex 設計書レビュー反映ログ（2026-06-14）

Codex(gpt-5.5, read-only, session 019ec22a) による設計書レビュー。指摘 P0×1 / P1×2 / P2×2、全採用。

| # | 指摘要旨 | 採否 | 反映先 |
|---|---|---|---|
| Step5-P0 | AC4 担保が OR 第一項だけでは不十分（`not_a_toilet>=5` で review 済も落ちる） | 採用 | §2 AC4 明文化 / §5.2 / §7 R3 |
| Step5-P1 | TS/SQL 二重ゲートの正規化ルール・truth table・同値テストが必要 | 採用 | §3 named 定義 / §5.1 canonical / §5.2 真理値表 |
| Step5-P1 | AC2 の sitemap 行数式・固定 ISR 分（sitemap 86400 / area 7日）が不足 | 採用 | §4.4 |
| Step5-P2 | inferred 除外理由の `isToiletUnconfirmed` 表現が UI 全体に読める | 採用 | §3 注記（個別SEOページ限定 + 型側 `isUnconfirmed` との区別） |
| Step5-P2 | `chunkCount` の `indexableCount=0 → 1` 境界明記 | 採用 | §6.5 |

却下・保留: なし（全指摘が実コードと整合し妥当）。総評: 採用シグナル方向性（named OSM + review維持 + inferred 除外）は妥当、実コード前提も大筋整合。
