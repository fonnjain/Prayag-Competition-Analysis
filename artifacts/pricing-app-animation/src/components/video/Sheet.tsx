import { motion } from 'framer-motion';
import type { CSSProperties, ReactNode } from 'react';

export const EASE = [0.22, 1, 0.36, 1] as const;
export const shot = (f: string) => `${import.meta.env.BASE_URL}shots/${f}.png`;

/** A screenshot as a physical sheet: thin chrome bar + grayscale capture (16:10). */
export function Sheet({ src, width, style, children, dark }: { src: string; width: string; style?: CSSProperties; children?: ReactNode; dark?: boolean }) {
  return (
    <div style={{ width, position: 'relative', borderRadius: '0.9vmin', overflow: 'hidden', background: '#f6f3ec',
      boxShadow: '0 3vmin 6vmin -2vmin rgba(22,32,30,.45), 0 0 0 1px rgba(22,32,30,.18)', ...style }}>
      <div style={{ height: '2.2vmin', background: dark ? '#26332f' : '#ddd5c4', display: 'flex', alignItems: 'center', gap: '0.6vmin', paddingLeft: '1.2vmin' }}>
        {[0, 1, 2].map((i) => <span key={i} style={{ width: '0.8vmin', height: '0.8vmin', borderRadius: 9, background: i === 0 ? '#e2522b' : 'rgba(22,32,30,.3)' }} />)}
      </div>
      <img src={src} alt="" style={{ display: 'block', width: '100%', aspectRatio: '16/10' }} />
      {children}
    </div>
  );
}

/** Vermilion evidence ring traced around a region of a sheet (percent coords of the image area). */
export function Ring({ x, y, w, h, delay = 0, label, labelSide = 'top' }: { x: number; y: number; w: number; h: number; delay?: number; label?: string; labelSide?: 'top' | 'bottom' }) {
  return (
    <div style={{ position: 'absolute', left: `${x}%`, top: `calc(2.2vmin + ${y}% * 0.9655)`, width: `${w}%`, height: `${h}%`, pointerEvents: 'none' }}>
      <svg width="100%" height="100%" style={{ overflow: 'visible', position: 'absolute', inset: 0 }} preserveAspectRatio="none" viewBox="0 0 100 100">
        <motion.rect x="0" y="0" width="100" height="100" rx="3" fill="rgba(226,82,43,.08)" stroke="#e2522b" strokeWidth="2.4" vectorEffect="non-scaling-stroke"
          initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} transition={{ delay, duration: 0.6, ease: EASE }} />
      </svg>
      {label && (
        <motion.div className="mono" initial={{ opacity: 0, y: labelSide === 'top' ? 8 : -8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: delay + 0.35, duration: 0.4, ease: EASE }}
          style={{ position: 'absolute', [labelSide === 'top' ? 'bottom' : 'top']: '100%', left: 0, margin: '0.6vmin 0', whiteSpace: 'nowrap',
            background: '#e2522b', color: '#efe9dd', fontSize: '1.5vmin', padding: '0.5vmin 1vmin', borderRadius: '0.4vmin' }}>
          {label}
        </motion.div>
      )}
    </div>
  );
}

export function Eyebrow({ children, delay = 0, light }: { children: ReactNode; delay?: number; light?: boolean }) {
  return (
    <motion.div className="mono" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay, duration: 0.45, ease: EASE }}
      style={{ fontSize: '2vmin', color: light ? '#efe9dd' : 'var(--ink)', display: 'flex', alignItems: 'center', gap: '1.2vmin' }}>
      <motion.span initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ delay: delay + 0.1, duration: 0.5, ease: EASE }}
        style={{ width: '4vmin', height: '0.35vmin', background: 'var(--sig)', transformOrigin: 'left', display: 'block' }} />
      {children}
    </motion.div>
  );
}

/** Masked line reveal. */
export function Line({ children, delay = 0, size, color, style }: { children: ReactNode; delay?: number; size: string; color?: string; style?: CSSProperties }) {
  return (
    <div style={{ overflow: 'hidden', paddingBottom: '0.12em', ...style }}>
      <motion.div className="disp" initial={{ y: '105%' }} animate={{ y: '0%' }} transition={{ delay, duration: 0.7, ease: EASE }}
        style={{ fontSize: size, fontWeight: 800, color: color ?? 'var(--ink)' }}>
        {children}
      </motion.div>
    </div>
  );
}
