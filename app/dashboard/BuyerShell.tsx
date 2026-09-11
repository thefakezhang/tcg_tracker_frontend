"use client";

import BuyerOrderView from "./BuyerOrderView";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import { LanguageProvider, useLanguage, LANGUAGE_LABELS, type Language } from "./LanguageContext";

// What a buying agent sees: his list, and nothing else.
//
// CUJ B says he signs in and lands directly on his assigned list - no
// navigation, no dashboard. Showing him the operator sidebar would be worse
// than useless: every other view would fail at the database, so he would be
// clicking through a menu of errors.
export function BuyerShell({ email, viewingAs = false }: { email: string; viewingAs?: boolean }) {
  // LanguageProvider lived only in DashboardShell, which is the OPERATOR's
  // shell and is returned INSTEAD of this one - so the agent was outside the
  // provider entirely and every translated string threw. He opens in Japanese.
  return (
    <LanguageProvider defaultLanguage="ja">
      <BuyerShellInner email={email} viewingAs={viewingAs} />
    </LanguageProvider>
  );
}

function BuyerShellInner({ email, viewingAs }: { email: string; viewingAs: boolean }) {
  const { t } = useTranslation();
  const { language, setLanguage } = useLanguage();
  return (
    <div className="min-h-screen">
      {viewingAs && (
        // Say so, plainly and always. An operator who forgets which screen
        // they are on will read the agent's blanks as their own mistake.
        <div className="border-b border-amber-500 bg-amber-500/10 px-4 py-1 text-center text-xs">
          {t("buyer.operatorPreview")}
        </div>
      )}
      <header className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b px-3 py-2 sm:px-4">
        <h1 className="font-semibold">{t("buyer.purchaseList")}</h1>
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2 text-sm text-muted-foreground sm:gap-3">
          <select
            aria-label="Language"
            className="min-h-11 rounded-md border bg-background px-2 py-1 text-sm sm:min-h-0"
            value={language}
            onChange={(e) => setLanguage(e.target.value as Language)}
          >
            {(Object.keys(LANGUAGE_LABELS) as Language[]).map((code) => (
              <option key={code} value={code}>{LANGUAGE_LABELS[code]}</option>
            ))}
          </select>
          <span className="min-w-0 max-w-36 truncate sm:max-w-none">{email}</span>
          <button
            className="min-h-11 px-1 underline underline-offset-2 sm:min-h-0"
            onClick={async () => {
              await createClient().auth.signOut();
              window.location.href = "/login";
            }}
          >
            {t("buyer.signOut")}
          </button>
        </div>
      </header>
      <BuyerOrderView />
    </div>
  );
}
