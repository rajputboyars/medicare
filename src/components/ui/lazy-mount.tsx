"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { SkeletonList } from "./skeleton-card";

/**
 * Renders `children` (and so starts their data fetching) only when the section is about to scroll into view.
 * Keeps the first screen fast on budget phones: below-the-fold sections cost nothing until needed.
 */
export function LazyMount({ children, placeholder, rootMargin = "300px", minHeight = 160 }: { children: ReactNode; placeholder?: ReactNode; rootMargin?: string; minHeight?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (visible || !ref.current) return;
    if (typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { setVisible(true); io.disconnect(); } }, { rootMargin });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [visible, rootMargin]);

  return <div ref={ref} style={visible ? undefined : { minHeight }}>{visible ? children : placeholder ?? <SkeletonList rows={1} />}</div>;
}
