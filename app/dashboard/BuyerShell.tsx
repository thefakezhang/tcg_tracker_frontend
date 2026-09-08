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
export function BuyerShell({ email }: { email: string }) {
  // LanguageProvider lived only in DashboardShell, which is the OPERATOR's
  // shell and is returned INSTEAD of this one - so the agent was outside the
  // provider entirely and every translated string threw. He opens in Japanese.
  return (
    <LanguageProvider defaultLanguage="ja">
      <BuyerShellInner email={email} />
    </LanguageProvider>
  );
}

function BuyerShellInner({ email }: { email: string }) {
  const { t } = useTranslation();
  const { language, setLanguage } = useLanguage();
  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b px-4 py-2">
        <h1 className="font-semibold">{t("buyer.purchaseList")}</h1>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <select
            aria-label="Language"
            className="rounded-md border bg-background px-2 py-1 text-sm"
            value={language}
            onChange={(e) => setLanguage(e.target.value as Language)}
          >
            {(Object.keys(LANGUAGE_LABELS) as Language[]).map((code) => (
              <option key={code} value={code}>{LANGUAGE_LABELS[code]}</option>
            ))}
          </select>
          <span>{email}</span>
          <button
            className="underline underline-offset-2"
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
