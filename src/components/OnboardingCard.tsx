"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, ArrowDownToLine, Ban, Droplets, Heart, MapPin, MessageSquarePlus, Sofa, X } from "lucide-react";

const STORAGE_KEY = "toilet-map.onboarding.dismissed";

const subscribe = () => () => {};
const getServer = () => true; // SSR は表示しない(後でハイドレートで判定)
const getClient = () => {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
};

// 色凡例(青=声かけ不要 / 黄=一声 / 赤=要許可)の太字は next-intl の t.rich() で描画する。
// JSX 側は {t.rich("colorLine", { b: (chunks) => <b>{chunks}</b> })}(下部参照)。
//
// WHY (#13 の独自 renderBold を廃し t.rich に統一 — この rebase 時に実データで検証して確定):
//   colorLine は messages/{ja,en,ko,zh}.json で `<b>青</b>=…` のタグ付き ICU メッセージ
//   (4 ファイルとも <b>…</b> で揃うのを確認済み)。タグ付きメッセージは t.rich() で描画するのが
//   next-intl の正しい API で、プレーンな t() で参照するのは誤用。Tranche B1 では t() 参照時に
//   太字にならず「onboarding.colorLine」の生キーが出る壊れ方を実際に観測した(use-intl の版により
//   throw かフォールバック表示かは分かれる — Codex の異モデルレビューで指摘 — が、いずれにせよ
//   正しい描画にはならない)。#13 は renderBold(= t() の生文字列を正規表現でパース)で回避しようと
//   したが、それ自体 t() を呼ぶため同じ誤用パスを踏む(=本番で壊れていた可能性)。さらに [B5] が
//   挙げた「他ページが colorLine を t() で参照する」後方互換懸念は grep で該当 0(参照は OnboardingCard
//   のみ)と判明し前提が崩れている。よって t.rich() + b ハンドラ(法務ページの t.rich(..., { link })
//   と同一パターン)が正しく安全(rebase 統合後 en で太字描画 + IntlError 無しを Playwright で確認)。

export function OnboardingCard() {
  const t = useTranslations("onboarding");
  const locale = useLocale();
  const dismissedFromStorage = useSyncExternalStore(subscribe, getClient, getServer);
  const [localDismissed, setLocalDismissed] = useState(false);
  const dismissed = dismissedFromStorage || localDismissed;

  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // Safari プライベートモード等
    }
    setLocalDismissed(true);
  }, []);

  if (dismissed) return null;

  // 日本語以外のロケール(海外からの旅行者想定)には「日本のトイレの使い方」を案内
  const showEtiquette = locale !== "ja";

  return (
    <div className="fixed inset-0 z-2000 flex items-end justify-center bg-black/50 p-2 sm:items-center sm:p-4">
      <div className="max-h-[88vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl dark:bg-zinc-900">
        <div className="mb-3 flex items-start justify-between">
          <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">{t("welcome")}</h2>
          <button
            type="button"
            onClick={dismiss}
            aria-label="close"
            className="rounded-full p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mb-4 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">{t("intro")}</p>

        <ul className="mb-5 space-y-2.5 text-sm">
          <li className="flex items-start gap-2.5">
            <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-500 text-[10px] font-bold text-white">
              {t("colorBadge")}
            </span>
            {/*
              WHY (t.rich() + b ハンドラ):
                colorLine は "<b>青</b>=声かけ不要 / …" のタグ付き ICU メッセージ。
                t() で取ると next-intl が IntlError を投げ生キーが表示される(本番バグ)。
                t.rich() にタグハンドラを渡すことで next-intl が安全に React ノードへ変換する。
                法務ページの t.rich("..."、{ link: … }) と同じパターン。
            */}
            <span className="text-zinc-700 dark:text-zinc-200">
              {t.rich("colorLine", { b: (chunks) => <b>{chunks}</b> })}
            </span>
          </li>
          <li className="flex items-start gap-2.5">
            <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-blue-500" />
            <span className="text-zinc-700 dark:text-zinc-200">{t("pinTap")}</span>
          </li>
          <li className="flex items-start gap-2.5">
            <MessageSquarePlus className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
            <span className="text-zinc-700 dark:text-zinc-200">{t("review")}</span>
          </li>
          <li className="flex items-start gap-2.5">
            <Heart className="mt-0.5 h-5 w-5 shrink-0 text-rose-500" />
            <span className="text-zinc-700 dark:text-zinc-200">{t("favorite")}</span>
          </li>
        </ul>

        {showEtiquette && (
          <div className="mb-4 rounded-lg border border-amber-300/60 bg-amber-50 p-3 dark:border-amber-800/60 dark:bg-amber-950/40">
            <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-amber-900 dark:text-amber-200">
              <AlertTriangle className="h-4 w-4" />
              {t("etiquetteTitle")}
            </p>
            <ul className="space-y-1.5 text-xs text-amber-900 dark:text-amber-200">
              <li className="flex items-start gap-2">
                <Sofa className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {t("etiquetteSit")}
              </li>
              <li className="flex items-start gap-2">
                <Droplets className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {t("etiquettePaper")}
              </li>
              <li className="flex items-start gap-2">
                <ArrowDownToLine className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {t("etiquetteFlush")}
              </li>
              <li className="flex items-start gap-2">
                <Ban className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {t("etiquetteNoStand")}
              </li>
            </ul>
          </div>
        )}

        <div className="mb-3 rounded-lg bg-blue-50 p-2.5 text-xs text-blue-900 dark:bg-blue-950/40 dark:text-blue-200">
          {t("disclaimer")}
        </div>

        <button
          type="button"
          onClick={dismiss}
          className="h-12 w-full rounded-lg bg-blue-600 text-base font-semibold text-white shadow hover:bg-blue-700"
        >
          {t("start")}
        </button>
      </div>
    </div>
  );
}
