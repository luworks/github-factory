import { appPath } from "../base-path";
import { ArrowUpRight, Orbit } from "lucide-react";
export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <a className="brand" href={appPath("/")} aria-label="Moon Factory home">
      <span className="brand-mark">
        <Orbit size={24} strokeWidth={1.5} />
      </span>
      <strong>
        moon factory<span className="brand-dot">.</span>
      </strong>
      {!compact && <span className="brand-tag">CODE INTO WORLDS</span>}
    </a>
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
