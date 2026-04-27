/**
 * Reveal — wraps children in a Framer Motion fade-in/slide-up.
 *
 * Use on top-level page content blocks so they animate in as the data
 * resolves instead of popping in. Cheap (one transform/opacity) and
 * respects `prefers-reduced-motion`.
 */
import { motion } from "framer-motion";
import { type ReactNode } from "react";

interface RevealProps {
  children: ReactNode;
  delay?: number;
  className?: string;
}

export function Reveal({ children, delay = 0, className }: RevealProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay, ease: "easeOut" }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
