"use client";

import { motion, AnimatePresence, type Variants, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

// Shared easing — a confident document "settle".
const EASE = [0.22, 1, 0.36, 1] as const;

// Container that staggers its children.
export const staggerParent: Variants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.07, delayChildren: 0.05 },
  },
};

// Default child: rise + fade.
export const riseItem: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE } },
};

// A stamp that lands: scale-down from oversize with a slight rotate, like being
// pressed onto the page.
export const stampItem: Variants = {
  hidden: { opacity: 0, scale: 1.6, rotate: -14 },
  show: {
    opacity: 1,
    scale: 1,
    rotate: -1.5,
    transition: { type: "spring", stiffness: 420, damping: 18, mass: 0.7 },
  },
};

// Reveal: animates once when scrolled into view.
export function Reveal({
  children,
  className,
  variants = riseItem,
  delay = 0,
  amount = 0.3,
}: {
  children: ReactNode;
  className?: string;
  variants?: Variants;
  delay?: number;
  amount?: number;
}) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      variants={variants}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount }}
      transition={{ delay }}
    >
      {children}
    </motion.div>
  );
}

// Stagger: a parent that reveals its children in sequence on scroll-in.
export function Stagger({
  children,
  className,
  amount = 0.2,
}: {
  children: ReactNode;
  className?: string;
  amount?: number;
}) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      variants={staggerParent}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount }}
    >
      {children}
    </motion.div>
  );
}

// A single staggered child (use inside <Stagger>).
export function Item({
  children,
  className,
  variants = riseItem,
}: {
  children: ReactNode;
  className?: string;
  variants?: Variants;
}) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div className={className} variants={variants}>
      {children}
    </motion.div>
  );
}

export { motion, AnimatePresence, useReducedMotion, EASE };
