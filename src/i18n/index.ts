import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import es from "./es.json";
import en from "./en.json";
import { getAppearance, useAppearance } from "@/lib/theme";
import { useEffect } from "react";

const STORAGE_KEY = "dbm.appearance";

function readBootLocale(): "es" | "en" {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return "es";
    const parsed = JSON.parse(raw);
    return parsed.locale === "en" ? "en" : "es";
  } catch {
    return "es";
  }
}

i18n.use(initReactI18next).init({
  resources: {
    es: { translation: es },
    en: { translation: en },
  },
  lng: readBootLocale(),
  fallbackLng: "es",
  interpolation: { escapeValue: false },
  returnNull: false,
});

// Keep i18n in sync when the user changes locale via the theme store.
export function useLocaleSync() {
  const { locale } = useAppearance();
  useEffect(() => {
    if (i18n.language !== locale) {
      void i18n.changeLanguage(locale);
    }
  }, [locale]);
}

// Eager sync at module load using whatever is in the appearance store right now.
queueMicrotask(() => {
  const target = getAppearance().locale;
  if (i18n.language !== target) {
    void i18n.changeLanguage(target);
  }
});

export default i18n;
