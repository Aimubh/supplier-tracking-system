"use client";

// LineSidebar (React Bits) — proximity-reactive nav. Each item shifts + colours
// toward the cursor, with leading marker lines that grow with proximity. Adapted
// to render arbitrary children per row (so we can keep icons/badges/locks) and to
// support disabled rows. A single rAF loop drives every item's --effect value.

import {
  useRef,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
  type CSSProperties,
} from "react";
import "./line-sidebar.css";

type Falloff = "linear" | "smooth" | "sharp";

const FALLOFF_CURVES: Record<Falloff, (p: number) => number> = {
  linear: (p) => p,
  smooth: (p) => p * p * (3 - 2 * p),
  sharp: (p) => p * p * p,
};

export interface LineSidebarItem {
  label: string;
  content: ReactNode; // what actually renders (icon + label + badge, or a Link)
  disabled?: boolean;
}

interface LineSidebarProps {
  items: LineSidebarItem[];
  accentColor?: string;
  textColor?: string;
  markerColor?: string;
  showMarker?: boolean;
  proximityRadius?: number;
  maxShift?: number;
  falloff?: Falloff;
  markerLength?: number;
  markerGap?: number;
  tickScale?: number;
  scaleTick?: boolean;
  itemGap?: number;
  smoothing?: number;
  activeIndex?: number | null;
  onItemClick?: (index: number, label: string) => void;
  className?: string;
}

export function LineSidebar({
  items,
  accentColor = "#15130E",
  textColor = "#333840",
  markerColor = "#9297a0",
  showMarker = true,
  proximityRadius = 110,
  maxShift = 10,
  falloff = "smooth",
  markerLength = 22,
  markerGap = 8,
  tickScale = 0.5,
  scaleTick = true,
  itemGap = 2,
  smoothing = 120,
  activeIndex = null,
  onItemClick,
  className = "",
}: LineSidebarProps) {
  const listRef = useRef<HTMLUListElement | null>(null);
  const itemRefs = useRef<Array<HTMLLIElement | null>>([]);
  const targetsRef = useRef<number[]>([]);
  const currentRef = useRef<number[]>([]);
  const rafRef = useRef<number | null>(null);
  const lastRef = useRef(0);
  const activeRef = useRef<number | null>(activeIndex);
  const smoothingRef = useRef(smoothing);
  const [, force] = useState(0);

  activeRef.current = activeIndex;
  smoothingRef.current = smoothing;

  const runFrame = useCallback((now: number) => {
    const dt = Math.min((now - lastRef.current) / 1000, 0.05);
    lastRef.current = now;
    const tau = Math.max(smoothingRef.current, 1) / 1000;
    const k = 1 - Math.exp(-dt / tau);

    let moving = false;
    const els = itemRefs.current;
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      if (!el) continue;
      const target = Math.max(targetsRef.current[i] || 0, activeRef.current === i ? 1 : 0);
      const cur = currentRef.current[i] || 0;
      const next = cur + (target - cur) * k;
      const settled = Math.abs(target - next) < 0.0015;
      const value = settled ? target : next;
      currentRef.current[i] = value;
      el.style.setProperty("--effect", value.toFixed(4));
      if (!settled) moving = true;
    }
    rafRef.current = moving ? requestAnimationFrame(runFrame) : null;
  }, []);

  const startLoop = useCallback(() => {
    if (rafRef.current != null) return;
    lastRef.current = performance.now();
    rafRef.current = requestAnimationFrame(runFrame);
  }, [runFrame]);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLUListElement>) => {
      const list = listRef.current;
      if (!list) return;
      const rect = list.getBoundingClientRect();
      const pointerY = e.clientY - rect.top;
      const ease = FALLOFF_CURVES[falloff] ?? FALLOFF_CURVES.linear;
      const els = itemRefs.current;
      for (let i = 0; i < els.length; i++) {
        const el = els[i];
        if (!el) continue;
        const center = el.offsetTop + el.offsetHeight / 2;
        const distance = Math.abs(pointerY - center);
        targetsRef.current[i] = ease(Math.max(0, 1 - distance / proximityRadius));
      }
      startLoop();
    },
    [falloff, proximityRadius, startLoop]
  );

  const handlePointerLeave = useCallback(() => {
    targetsRef.current = targetsRef.current.map(() => 0);
    startLoop();
  }, [startLoop]);

  // Re-run the loop whenever the active item changes so its --effect settles to 1.
  useEffect(() => {
    startLoop();
    force((n) => n + 1);
  }, [activeIndex, startLoop]);

  useEffect(
    () => () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    },
    []
  );

  const styleVars = {
    "--accent-color": accentColor,
    "--text-color": textColor,
    "--marker-color": markerColor,
    "--marker-length": `${markerLength}px`,
    "--marker-gap": `${markerGap}px`,
    "--tick-scale": tickScale,
    "--max-shift": `${maxShift}px`,
    "--item-gap": `${itemGap}px`,
    "--smoothing": `${smoothing}ms`,
  } as CSSProperties;

  return (
    <nav
      className={`line-sidebar${showMarker ? " line-sidebar--markers" : ""}${
        scaleTick ? " line-sidebar--scale-tick" : ""
      }${className ? ` ${className}` : ""}`}
      style={styleVars}
    >
      <ul
        ref={listRef}
        className="line-sidebar__list"
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
      >
        {items.map((item, index) => (
          <li
            key={`${item.label}-${index}`}
            ref={(el) => {
              itemRefs.current[index] = el;
            }}
            className={`line-sidebar__item${item.disabled ? " line-sidebar__item--disabled" : ""}`}
            aria-current={activeIndex === index ? "true" : undefined}
            onClick={() => {
              if (item.disabled) return;
              onItemClick?.(index, item.label);
            }}
          >
            {showMarker && <span className="line-sidebar__marker" aria-hidden="true" />}
            <span className="line-sidebar__label">{item.content}</span>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export default LineSidebar;
