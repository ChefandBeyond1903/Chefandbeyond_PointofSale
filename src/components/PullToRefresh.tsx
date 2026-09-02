"use client";

import { useEffect, useRef, useState } from "react";

const THRESHOLD = 70; // px of pull needed to trigger
const MAX = 110; // px the indicator travels
const RESISTANCE = 0.5;

/**
 * Mobile pull-to-refresh: hold near the top of the page and drag down; release
 * past the threshold to reload. Mounted once in the root layout so it works on
 * every screen. A hard reload also picks up the latest deployed build.
 */
export function PullToRefresh() {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const startY = useRef<number | null>(null);
  const active = useRef(false);

  // Auto-reload when a newer build has been deployed — so the phone picks up
  // changes without a manual hard refresh. Checks on load, on tab focus, and
  // every few minutes.
  useEffect(() => {
    let booted: string | null = null;
    let stopped = false;

    async function check() {
      if (stopped || document.visibilityState !== "visible") return;
      try {
        const r = await fetch("/api/version", { cache: "no-store" });
        const { version } = (await r.json()) as { version: string };
        if (!version || version === "dev") return;
        if (booted === null) {
          booted = version;
        } else if (version !== booted) {
          window.location.reload();
        }
      } catch {
        /* offline / transient — try again next tick */
      }
    }

    check();
    const iv = setInterval(check, 3 * 60 * 1000);
    document.addEventListener("visibilitychange", check);
    return () => {
      stopped = true;
      clearInterval(iv);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);

  useEffect(() => {
    // Only on touch devices.
    if (typeof window === "undefined" || !("ontouchstart" in window)) return;

    // An ancestor of `el` (up to <body>) is scrolled down — let it scroll, not us.
    function insideScrolledArea(el: EventTarget | null): boolean {
      let n = el as HTMLElement | null;
      while (n && n !== document.body) {
        if (n.scrollTop > 0) return true;
        n = n.parentElement;
      }
      return false;
    }

    function onStart(e: TouchEvent) {
      if (refreshing || e.touches.length !== 1) return;
      if (window.scrollY > 0 || insideScrolledArea(e.target)) return;
      startY.current = e.touches[0].clientY;
      active.current = true;
      setDragging(true);
    }

    function onMove(e: TouchEvent) {
      if (!active.current || startY.current === null) return;
      const delta = e.touches[0].clientY - startY.current;
      if (delta <= 0) {
        setPull(0);
        return;
      }
      // We're claiming this gesture — stop the browser's native overscroll.
      if (e.cancelable) e.preventDefault();
      setPull(Math.min(delta * RESISTANCE, MAX));
    }

    function onEnd() {
      if (!active.current) return;
      active.current = false;
      startY.current = null;
      setDragging(false);
      setPull((p) => {
        if (p >= THRESHOLD) {
          setRefreshing(true);
          // Let the spinner paint, then reload.
          setTimeout(() => window.location.reload(), 150);
          return THRESHOLD;
        }
        return 0;
      });
    }

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd, { passive: true });
    window.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, [refreshing]);

  const visible = pull > 0 || refreshing;
  const ready = pull >= THRESHOLD || refreshing;

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-[100] flex justify-center"
      style={{
        transform: `translateY(${visible ? Math.min(pull, MAX) - 44 : -48}px)`,
        transition: dragging ? "none" : "transform 200ms ease",
      }}
    >
      <div className="mt-2 grid h-9 w-9 place-items-center rounded-full border border-zinc-200 bg-white shadow-md">
        <span
          className={`text-zinc-500 ${refreshing ? "animate-spin" : ""}`}
          style={{ transform: refreshing ? "none" : `rotate(${ready ? 180 : 0}deg)`, transition: "transform 150ms" }}
        >
          {refreshing ? "⟳" : "↓"}
        </span>
      </div>
    </div>
  );
}
