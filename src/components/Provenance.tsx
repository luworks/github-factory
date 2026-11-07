import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Info } from "lucide-react";
import "./provenance.css";

export type ProvenanceTone = "fresh" | "stale" | "partial" | "error" | "demo" | "unknown";

/**
 * A calm one-line summary chip that discloses the full provenance record.
 * Opens on click/Enter/Space (pinned) and, for mouse pointers, on hover.
 * Escape or focus leaving the widget closes it. Closed details stay in the DOM
 * (hidden) so the honesty record is never removed, only de-emphasised.
 */
export function ProvenanceDisclosure({
  summary, title, tone, children, className = "", align = "start", direction = "down",
}: {
  summary: ReactNode; title: string; tone: ProvenanceTone; children: ReactNode;
  className?: string; align?: "start" | "end"; direction?: "up" | "down";
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const open = pinned || hovered;
  useEffect(() => {
    if (!pinned) return;
    const outside = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setPinned(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [pinned]);
  return (
    <div
      ref={root}
      className={`provenance ${className}`}
      data-tone={tone}
      data-open={open}
      data-align={align}
      data-direction={direction}
      onPointerEnter={(e) => { if (e.pointerType === "mouse") setHovered(true); }}
      onPointerLeave={(e) => { if (e.pointerType === "mouse") setHovered(false); }}
      onBlur={(e) => { if (!root.current?.contains(e.relatedTarget as Node | null)) setPinned(false); }}
      onKeyDown={(e) => {
        if (e.key !== "Escape" || !open) return;
        e.stopPropagation();
        setPinned(false); setHovered(false);
        trigger.current?.focus();
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="provenance-trigger"
        aria-expanded={open}
        aria-controls={id}
        onClick={(e) => {
          e.stopPropagation();
          if (pinned) { setPinned(false); setHovered(false); } else setPinned(true);
        }}
      >
        <span className="provenance-dot" aria-hidden="true" />
        <span className="provenance-summary">{summary}</span>
        <Info size={12} aria-hidden="true" className="provenance-icon" />
        <span className="sr-only">{` — ${title}`}</span>
      </button>
      <div id={id} className="provenance-panel" role="group" aria-label={title} hidden={!open}>
        {children}
      </div>
    </div>
  );
}

/** A labelled fact row inside a provenance panel. */
export function Fact({ term, children }: { term: string; children: ReactNode }) {
  return <div className="provenance-fact"><dt>{term}</dt><dd>{children}</dd></div>;
}

const UTC_DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
/** "Nov 4" for a capture timestamp (UTC, matching the full stamp in the panel). */
export function shortDay(iso: string | null) {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : UTC_DAY.format(date);
}
export function utcStamp(iso: string) {
  return `${new Date(iso).toISOString().replace("T", " ").slice(0, 16)} UTC`;
}
/** "1 observed · 29 inferred" with zero groups kept explicit. */
export function confidenceCounts(items: { confidence: "observed" | "inferred" }[]) {
  const observed = items.filter((item) => item.confidence === "observed").length;
  return `${observed} observed / ${items.length - observed} inferred`;
}
/** Snapshot status lamps, e.g. "1 active · 29 unknown"; unknown is always listed. */
export function statusCounts(nodes: { status: "healthy" | "active" | "attention" | "unknown" }[]) {
  const count = (status: string) => nodes.filter((node) => node.status === status).length;
  return [...(["healthy", "active", "attention"] as const).filter((s) => count(s)).map((s) => `${count(s)} ${s}`), `${count("unknown")} unknown`].join(" · ");
}
