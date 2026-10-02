"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { logProctorEvent } from "@/app/actions/proctor";
import { AlertTriangle, X } from "lucide-react";

interface ProctorGuardProps {
  attemptId: string;
  onViolationCountChange?: (count: number) => void;
}

const MAX_WARNINGS = 5;

export function ProctorGuard({
  attemptId,
  onViolationCountChange,
}: ProctorGuardProps) {
  const [violations, setViolations] = useState(0);
  const [warning, setWarning] = useState<string | null>(null);
  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastEventRef = useRef<number>(0);

  const logEvent = useCallback(
    async (
      eventType: "tab_blur" | "fullscreen_exit" | "paste" | "focus_lost",
      extra?: Record<string, unknown>
    ) => {
      // Debounce: ignore events within 1 second of each other
      const now = Date.now();
      if (now - lastEventRef.current < 1000) return;
      lastEventRef.current = now;

      try {
        const result = await logProctorEvent({
          attemptId,
          eventType,
          metadata: extra,
        });
        setViolations(result.violationCount);
        onViolationCountChange?.(result.violationCount);

        const messages: Record<string, string> = {
          tab_blur: "Perpindahan tab terdeteksi",
          focus_lost: "Jendela kehilangan fokus",
          fullscreen_exit: "Keluar dari mode layar penuh",
          paste: "Paste terdeteksi pada area jawaban",
        };

        setWarning(
          `${messages[eventType] ?? "Pelanggaran terdeteksi"} — Peringatan ${result.violationCount} dari ${MAX_WARNINGS}`
        );

        if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
        warningTimerRef.current = setTimeout(() => setWarning(null), 5000);
      } catch {
        // Silent fail
      }
    },
    [attemptId, onViolationCountChange]
  );

  useEffect(() => {
    // Tab blur / visibility change
    function handleVisibilityChange() {
      if (document.hidden) {
        logEvent("tab_blur");
      }
    }

    // Window blur (focus lost)
    function handleBlur() {
      logEvent("focus_lost");
    }

    // Paste detection
    function handlePaste(e: ClipboardEvent) {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "TEXTAREA" ||
        target.closest("[data-exam-content]")
      ) {
        logEvent("paste");
      }
    }

    // Fullscreen exit
    function handleFullscreenChange() {
      if (!document.fullscreenElement) {
        logEvent("fullscreen_exit");
      }
    }

    // Disable right-click on exam content
    function handleContextMenu(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (target.closest("[data-exam-content]")) {
        e.preventDefault();
      }
    }

    // Disable text selection on exam content (light touch)
    function handleSelectStart(e: Event) {
      const target = e.target as HTMLElement;
      if (
        target.closest("[data-exam-content]") &&
        !target.closest("input, textarea, [data-selectable]")
      ) {
        e.preventDefault();
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("blur", handleBlur);
    document.addEventListener("paste", handlePaste);
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("contextmenu", handleContextMenu);
    document.addEventListener("selectstart", handleSelectStart);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("blur", handleBlur);
      document.removeEventListener("paste", handlePaste);
      document.removeEventListener(
        "fullscreenchange",
        handleFullscreenChange
      );
      document.removeEventListener("contextmenu", handleContextMenu);
      document.removeEventListener("selectstart", handleSelectStart);
      if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
    };
  }, [logEvent]);

  if (!warning) return null;

  return (
    <div className="fixed top-14 left-1/2 -translate-x-1/2 z-50 max-w-md w-full px-4">
      <div className="flex items-center gap-3 bg-warning/10 border border-warning/30 text-warning px-4 py-3 rounded-[var(--radius)] shadow-[var(--shadow)]">
        <AlertTriangle size={16} className="shrink-0" />
        <p className="text-sm flex-1">{warning}</p>
        <button
          onClick={() => setWarning(null)}
          className="shrink-0 text-warning/60 hover:text-warning"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

export function FullscreenToggle() {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    function handler() {
      setIsFullscreen(!!document.fullscreenElement);
    }
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  function toggle() {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen();
    }
  }

  return (
    <button
      onClick={toggle}
      className="text-xs text-text-muted hover:text-text transition-colors px-2 py-1 border border-border rounded-[var(--radius-sm)]"
    >
      {isFullscreen ? "Keluar Layar Penuh" : "Layar Penuh"}
    </button>
  );
}
