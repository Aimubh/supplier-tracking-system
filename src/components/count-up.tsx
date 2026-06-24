"use client";

import { useEffect, useRef, useState } from "react";
import { useInView, useReducedMotion } from "motion/react";

// Animated tabular figure that counts up to `value` when scrolled into view.
// Falls back to the final value immediately when reduced motion is requested.
export function CountUp({
  value,
  duration = 1.1,
  className,
  pad = 0,
}: {
  value: number;
  duration?: number;
  className?: string;
  pad?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.6 });
  const reduce = useReducedMotion();
  const [display, setDisplay] = useState(reduce ? value : 0);

  useEffect(() => {
    if (!inView || reduce) {
      if (reduce) setDisplay(value);
      return;
    }
    let raf = 0;
    let start: number | null = null;
    const ease = (t: number) => 1 - Math.pow(1 - t, 3); // easeOutCubic
    const tick = (ts: number) => {
      if (start === null) start = ts;
      const p = Math.min((ts - start) / (duration * 1000), 1);
      setDisplay(Math.round(ease(p) * value));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, reduce, value, duration]);

  const text = pad > 0 ? String(display).padStart(pad, "0") : String(display);
  return (
    <span ref={ref} className={className}>
      {text}
    </span>
  );
}
