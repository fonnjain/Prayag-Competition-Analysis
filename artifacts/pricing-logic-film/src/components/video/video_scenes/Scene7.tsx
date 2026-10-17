import { motion } from 'framer-motion';
import { C, Shell, Line, Pop, useBeats, serif, mono, sans, Eyebrow, Sweep } from '../kit';

function Row({ show, k, v, big, color }: { show: boolean; k: string; v: string; big?: boolean; color?: string }) {
  return (
    <Pop show={show}>
      <div className="flex justify-between items-baseline" style={{ padding: '1.6vmin 0', borderBottom: `2px dashed ${C.ink}33` }}>
        <span style={{ ...sans, fontSize: '2.8vmin', opacity: 0.7 }}>{k}</span>
        <span style={{ ...mono, fontSize: big ? '7vmin' : '4vmin', color: color ?? C.ink, fontWeight: big ? 600 : 400 }}>{v}</span>
      </div>
    </Pop>
  );
}

export function Scene7() {
  const b = useBeats([400, 1400, 2400, 3600, 5000, 6600, 8600, 11000, 12600, 15000, 18500]);
  return (
    <Shell>
      <Eyebrow n="06">Price Calculator · invoice arithmetic</Eyebrow>
      <motion.div className="absolute" style={{ right: '9%', top: '10%', width: '44%', height: '82%', background: '#F7F2E6', borderRadius: '1.5vmin', padding: '4vmin', boxShadow: `0 3vmin 6vmin ${C.ink}22` }}
        initial={{ y: '40%', rotate: 4, opacity: 0 }} animate={{ y: 0, rotate: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 120, damping: 20 }}>
        <div style={{ ...mono, fontSize: '2vmin', letterSpacing: '0.2em', opacity: 0.5 }}>LINE 1 · PRODUCT 0417 · STANDARD</div>
        <Row show={b >= 2} k="MRP" v="92.00" />
        <Row show={b >= 3} k="Own discount" v="33.33%" color={C.teal} />
        <Row show={b >= 4} k="Net unit (exact)" v="61.3364…" />
        <Row show={b >= 5} k="Net unit · rounded" v="61.34" color={C.red} />
        <Row show={b >= 6} k="× Quantity" v="7" />
        <Row show={b >= 7} k="Line total" v="429.38" big />
        <motion.div className="relative" initial={{ opacity: 0 }} animate={{ opacity: b >= 8 ? 1 : 0 }} style={{ marginTop: '2vmin', ...mono, fontSize: '2.6vmin', color: C.mute }}>
          92 × 7 × 0.6667 = 429.35
          <motion.div className="absolute" style={{ left: 0, top: '50%', height: 3, width: '100%', background: C.red, transformOrigin: 'left' }} initial={{ scaleX: 0 }} animate={{ scaleX: b >= 8 ? 1 : 0 }} transition={{ delay: 0.4 }} />
        </motion.div>
      </motion.div>
      <div className="absolute" style={{ left: '10%', top: '24%', width: '38%', ...serif, fontSize: '8vmin', lineHeight: 1.02 }}>
        <Line show={b >= 1}>Round the unit</Line>
        <Line show={b >= 1} delay={0.15}><i style={{ color: C.red }}>first.</i></Line>
        <Line show={b >= 9} delay={0}>Then multiply.</Line>
      </div>
      <div className="absolute" style={{ left: '10%', bottom: '10%', width: '36%', ...sans, fontSize: '2.8vmin' }}>
        <Pop show={b >= 10}>Read-only. The calculator never saves prices or settings — it only shows exact invoice maths.</Pop>
      </div>
      <Sweep at={b >= 11} />
    </Shell>
  );
}
