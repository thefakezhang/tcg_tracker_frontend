"use client";

import { DollarSign, Globe, LogOut } from "lucide-react";
import { type Language, LANGUAGE_LABELS } from "./LanguageContext";
import { type DisplayCurrency, CURRENCY_LABELS } from "./CurrencyContext";
import type { TranslationKey } from "@/lib/i18n";
import {
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

const LANGUAGES = Object.keys(LANGUAGE_LABELS) as Language[];
const CURRENCIES = Object.keys(CURRENCY_LABELS) as DisplayCurrency[];

interface AccountMenuContentProps {
  t: (key: TranslationKey) => string;
  language: Language;
  onLanguageChange: (lang: Language) => void;
  currency: DisplayCurrency;
  onCurrencyChange: (c: DisplayCurrency) => void;
  onLogout: () => void;
}

// The account dropdown's content: language + currency radio groups and logout.
// Presentational and provider-free so it can be render-tested in isolation - the
// crash it guards against (see AccountMenuContent.test.tsx) is a runtime one that
// only fires when this content actually mounts on menu open, which neither tsc
// nor the build exercises.
//
// Each label + radio group MUST stay wrapped in a DropdownMenuGroup:
// DropdownMenuLabel renders base-ui's GroupLabel, which throws
// "MenuGroupContext is missing" unless it has a Group/RadioGroup ancestor.
export function AccountMenuContent({
  t,
  language,
  onLanguageChange,
  currency,
  onCurrencyChange,
  onLogout,
}: AccountMenuContentProps) {
  return (
    <DropdownMenuContent side="top" align="start">
      <DropdownMenuGroup>
        <DropdownMenuLabel className="flex items-center gap-2">
          <Globe className="size-4" />
          {t("sidebar.language")}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup value={language} onValueChange={(v) => onLanguageChange(v as Language)}>
          {LANGUAGES.map((lang) => (
            <DropdownMenuRadioItem key={lang} value={lang}>
              {LANGUAGE_LABELS[lang]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuLabel className="flex items-center gap-2">
          <DollarSign className="size-4" />
          {t("sidebar.convertCurrency")}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup value={currency} onValueChange={(v) => onCurrencyChange(v as DisplayCurrency)}>
          {CURRENCIES.map((c) => (
            <DropdownMenuRadioItem key={c} value={c}>
              {CURRENCY_LABELS[c]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={onLogout}>
        <LogOut className="mr-2 size-4" />
        {t("sidebar.logOut")}
      </DropdownMenuItem>
    </DropdownMenuContent>
  );
}
