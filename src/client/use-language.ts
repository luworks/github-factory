import { useEffect, useState } from "react";
import type { Lang } from "../contracts";
export function useLanguage(): [Lang, (lang: Lang) => void] {
  const [lang, setLang] = useState<Lang>("en");
  useEffect(() => {
    try {
      const value = localStorage.getItem("moonshot.lang");
      if (value === "zh") setLang("zh");
    } catch {}
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  }, [lang]);
  return [
    lang,
    (next: Lang) => {
      setLang(next);
      try {
        localStorage.setItem("moonshot.lang", next);
      } catch {}
    },
  ];
}
