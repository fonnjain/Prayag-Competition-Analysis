import { useState, type CSSProperties, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { useSceneTimer } from '@/lib/video';

export const C = { paper: '#EFE8D8', paper2: '#E6DDC8', ink: '#172440', red: '#E0482B', teal: '#2C7A70', amber: '#D9971C', mute: '#8a8f9c' };
export const EASE = [0.22, 1, 0.36, 1] as const;
export const mono: CSSProperties = { fontFamily: 'IBM Plex Mono, monospace' };
export const sans: CSSProperties = { fontFamily: 'Instrument Sans, sans-serif' };
export const serif: CSSProperties = { fontFamily: 'Fraunces, serif' };

/** Returns how many of the given times (ms) have passed on the scene clock. */
export function useBeats(times: number[]) {
  const [b, setB] = useState(0);
  useSceneTimer(times.map((t, i) => ({ time: t, callback: () => setB(i + 1) })));
  return b;
}

/** Odometer stepped on the scene clock. */
export function useCount(from: number, to: number, start: number, dur = 900) {
  const steps = 24;
  const [v, setV] = useState(from);
  useSceneTimer(Array.from({ length: steps + 1 }, (_, i) => ({
    time: start + (dur * i) / steps,
    callback: () => setV(from + ((to - from) * (1 - Math.pow(1 - i / steps, 3)))),
  })));
  return v;
}

export const fmt = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function Shell({ children, bg = C.paper }: { children: ReactNode; bg?: string }) {
  return (
    <motion.div className="absolute inset-0 overflow-hidden" style={{ background: bg, color: C.ink }}
      initial={{ opacity: 0, scale: 1.04 }} animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97, filter: 'blur(6px)' }} transition={{ duration: 0.7, ease: EASE }}>
      <Rules />
      {children}
    </motion.div>
  );
}

function Rules() {
  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none" preserveAspectRatio="none" viewBox="0 0 100 100">
      {Array.from({ length: 14 }, (_, i) => (
        <motion.line key={i} x1="0" x2="100" y1={7 * i + 4} y2={7 * i + 4} stroke={C.ink} strokeOpacity={0.07} strokeWidth={0.08}
          initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.2, delay: i * 0.04, ease: EASE }} />
      ))}
      <line x1="8" x2="8" y1="0" y2="100" stroke={C.red} strokeOpacity={0.25} strokeWidth={0.1} />
    </svg>
  );
}

export function Line({ show, children, style, delay = 0 }: { show: boolean; children: ReactNode; style?: CSSProperties; delay?: number }) {
  return (
    <div style={{ overflow: 'hidden', paddingBottom: '0.12em', ...style }}>
      <motion.div initial={{ y: '110%' }} animate={{ y: show ? '0%' : '110%' }} transition={{ duration: 0.7, delay, ease: EASE }}>{children}</motion.div>
    </div>
  );
}

export function Pop({ show, children, style, from = 12 }: { show: boolean; children: ReactNode; style?: CSSProperties; from?: number }) {
  return (
    <motion.div style={style} initial={{ opacity: 0, y: from, scale: 0.96 }}
      animate={show ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: from, scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 260, damping: 24 }}>{children}</motion.div>
  );
}

export function Eyebrow({ children, n }: { children: ReactNode; n: string }) {
  return (
    <motion.div className="absolute flex items-center gap-[1.2vmin]" style={{ left: '10%', top: '7%', ...mono, fontSize: '2vmin', letterSpacing: '0.18em' }}
      initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.5 }}>
      <span style={{ color: C.red }}>{n}</span><span style={{ width: '5vmin', height: 2, background: C.ink, opacity: 0.4 }} />
      <span style={{ textTransform: 'uppercase' }}>{children}</span>
    </motion.div>
  );
}

/** Vermilion carrier bar that sweeps across near each scene's end. */
export function Sweep({ at }: { at: boolean }) {
  return (
    <motion.div className="absolute left-0 top-0 h-full" style={{ width: '100%', background: C.red, transformOrigin: 'left' }}
      initial={{ scaleX: 0, opacity: 0.9 }} animate={at ? { scaleX: [0, 1, 1], opacity: [0.9, 0.9, 0], x: ['0%', '0%', '100%'] } : { scaleX: 0 }}
      transition={{ duration: 1.4, times: [0, 0.5, 1], ease: 'easeInOut' }} />
  );
}

export function Tag({ color, children }: { color: string; children: ReactNode }) {
  return <span style={{ ...mono, fontSize: '1.9vmin', padding: '0.4vmin 1.2vmin', borderRadius: 999, border: `2px solid ${color}`, color }}>{children}</span>;
}
