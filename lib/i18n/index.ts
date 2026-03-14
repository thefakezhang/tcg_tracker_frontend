import { useCallback } from "react";
import { useLanguage, type Language } from "@/app/dashboard/LanguageContext";
import en from "./en";
import ja from "./ja";

export type TranslationKey = keyof typeof en;

const translations: Record<Language, Record<TranslationKey, string>> = { en, ja };

export function t(
  language: Language,
  key: TranslationKey,
  params?: Record<string, string | number>
): string {
  let str = translations[language][key];
  if (params) {
    str = str.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? `{${k}}`));
  }
  return str;
}

export function useTranslation() {
  const { language } = useLanguage();
  const translate = useCallback(
    (key: TranslationKey, params?: Record<string, string | number>) =>
      t(language, key, params),
    [language]
  );
  return { t: translate, language };
}
