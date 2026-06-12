"use client";

import { useEffect, useState } from "react";
import { LayoutGrid, List } from "lucide-react";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "leap:admin:packs-view";

export type PacksView = "grid" | "list";

export function PacksViewToggle({ onChange }: { onChange: (v: PacksView) => void }) {
  const [view, setView] = useState<PacksView>("grid");

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY) as PacksView | null;
      if (stored === "grid" || stored === "list") {
        setView(stored);
        onChange(stored);
      } else {
        onChange("grid");
      }
    } catch {
      onChange("grid");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pick(v: PacksView) {
    setView(v);
    try {
      window.localStorage.setItem(STORAGE_KEY, v);
    } catch {}
    onChange(v);
  }

  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-ink-900/10 bg-white p-1 text-xs">
      <button
        type="button"
        onClick={() => pick("grid")}
        aria-pressed={view === "grid"}
        className={cn(
          "inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-medium transition",
          view === "grid" ? "bg-ink-900 text-white" : "text-ink-600 hover:bg-ink-900/5",
        )}
      >
        <LayoutGrid size={14} /> Grelha
      </button>
      <button
        type="button"
        onClick={() => pick("list")}
        aria-pressed={view === "list"}
        className={cn(
          "inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-medium transition",
          view === "list" ? "bg-ink-900 text-white" : "text-ink-600 hover:bg-ink-900/5",
        )}
      >
        <List size={14} /> Lista
      </button>
    </div>
  );
}
