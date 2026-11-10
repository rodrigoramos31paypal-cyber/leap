"use client";

import { useEffect } from "react";

export function ViewportKeyboard() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const root = document.documentElement;
    const editable = "textarea, input:not([type=checkbox]):not([type=radio]):not([type=button]), [contenteditable=true]";
    let restingHeight = Math.max(window.innerHeight, viewport.height);
    let frame = 0;

    function update() {
      if (!viewport) return;
      const writing = document.activeElement?.matches(editable);
      const wasOpen = root.classList.contains("kb-open");
      if (!writing && !wasOpen) restingHeight = Math.max(window.innerHeight, viewport.height);

      // iOS can shrink innerHeight and move the visible viewport on focus.
      // Compare against the height measured before the keyboard opened.
      const reduced = restingHeight - viewport.height > 100;
      const shifted = Math.abs(viewport.offsetTop) > 24;
      const open = !!(writing || wasOpen) && (reduced || shifted);
      if (!open) restingHeight = Math.max(window.innerHeight, viewport.height);

      root.style.setProperty("--keyboard-viewport-height", `${viewport.height}px`);
      root.style.setProperty("--keyboard-viewport-top", `${Math.max(0, viewport.offsetTop)}px`);
      root.classList.toggle("kb-open", open);
    }

    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    update();
    viewport.addEventListener("resize", schedule);
    viewport.addEventListener("scroll", schedule);
    window.addEventListener("resize", schedule);
    document.addEventListener("focusin", schedule);
    document.addEventListener("focusout", schedule);
    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener("resize", schedule);
      viewport.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      document.removeEventListener("focusin", schedule);
      document.removeEventListener("focusout", schedule);
      root.classList.remove("kb-open");
      root.style.removeProperty("--keyboard-viewport-height");
      root.style.removeProperty("--keyboard-viewport-top");
    };
  }, []);

  return null;
}
