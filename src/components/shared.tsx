import { appPath } from "../base-path";
import { ArrowUpRight, Orbit } from "lucide-react";
import { useEffect, useState } from "react";
import type { Lang } from "../contracts";
export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <a className="brand" href={appPath("/")} aria-label="Moonshot home">
      <span className="brand-mark">
        <Orbit size={24} strokeWidth={1.5} />
      </span>
      <strong>
        moonshot<span className="brand-dot">.</span>
      </strong>
      {!compact && <span className="brand-tag">CODE INTO WORLDS</span>}
    </a>
  );
}
export function LanguageButton({ lang, onChange }: { lang: Lang; onChange: (lang: Lang) => void }) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return (
    <button
      className="language-toggle"
      disabled={!ready}
      aria-label="Switch language"
      onClick={() => onChange(lang === "en" ? "zh" : "en")}
    >
      {lang === "en" ? "EN / ZH" : "中文 / EN"}
    </button>
  );
}
export function External({ href, children, className = "" }: { href: string; children: React.ReactNode; className?: string }) {
  let valid = false;
  try {
    const u = new URL(href);
    valid = u.protocol === "https:" && ["github.com", "api.github.com"].includes(u.hostname) && !u.username && !u.password;
  } catch {}
  return valid ? (
    <a className={className} href={href} target="_blank" rel="noreferrer noopener">
      {children}
      <ArrowUpRight size={12} />
    </a>
  ) : (
    <span className={className}>{children}</span>
  );
}
