import { motion } from 'framer-motion';
import { C, Shell, Line, Pop, useBeats, serif, mono, sans, Eyebrow, Sweep, Tag } from '../kit';
import { Lock } from 'lucide-react';

const RUNS = [
  ['0417', 'suggested 1,263.10', C.teal],
  ['1182', 'excluded · no competitor quote', C.amber],
  ['2290', 'excluded · no usable BOM', C.amber],
  ['3051', 'suggested 486.00', C.teal],
  ['3388', 'unchanged · held', C.mute],
] as const;

export function Scene5() {
  const b = useBeats([400, 1400, 2400, 3400, 4400, 5400, 8000, 9200, 10400, 11600, 14000, 18500]);
  return (
    <Shell>
      <Eyebrow n="04">Run record</Eyebrow>
      <div className="absolute" style={{ left: '10%', top: '22%', ...serif, fontSize: '9vmin', lineHeight: 1 }}>
        <Line show={b >= 1}>Excluded,</Line>
        <Line show={b >= 1} delay={0.15}><i style={{ color: C.red }}>not guessed.</i></Line>
      </div>
      <div className="absolute" style={{ right: '7%', top: '12%', width: '48%' }}>
        {RUNS.map((r, i) => (
          <Pop key={r[0]} show={b >= 2 + i && b < 7}>
            <div className="flex items-center justify-between" style={{ padding: '2vmin 2.5vmin', borderBottom: `2px solid ${C.ink}22`, ...mono, fontSize: '2.8vmin' }}>
              <span>Product {r[0]}</span><Tag color={r[2]}>{r[1]}</Tag>
            </div>
          </Pop>
        ))}
      </div>
      <motion.div className="absolute" style={{ right: '7%', top: '14%', width: '48%', background: C.ink, color: C.paper, borderRadius: '2vmin', padding: '4vmin', transformOrigin: 'top', perspective: 800 }}
        initial={{ rotateX: -90, opacity: 0 }} animate={b >= 7 ? { rotateX: 0, opacity: 1 } : {}} transition={{ type: 'spring', stiffness: 160, damping: 20 }}>
        <div className="flex items-center" style={{ gap: '2vmin', ...serif, fontSize: '4.4vmin' }}><Lock size="4vmin" color={C.red} /> Trace · Product 0417</div>
        {[['Matched rule', '#2 · Fittings · market median'], ['Inputs snapshot', '3 quotes · Sales period FY26-27 Q1'], ['Policy', 'v3 · floor 28% · band A'], ['Binding constraint', 'margin floor'], ['Run', 'immutable · rerun gives same answer']].map((r, i) => (
          <motion.div key={r[0]} className="flex justify-between" initial={{ opacity: 0 }} animate={{ opacity: b >= 8 + Math.floor(i / 2) ? 1 : 0 }}
            style={{ padding: '1.6vmin 0', borderBottom: `1px solid ${C.paper}33`, ...mono, fontSize: '2.4vmin' }}>
            <span style={{ opacity: 0.6 }}>{r[0]}</span><span>{r[1]}</span>
          </motion.div>
        ))}
      </motion.div>
      <div className="absolute" style={{ left: '10%', bottom: '12%', width: '36%', ...sans, fontSize: '3vmin' }}>
        <Pop show={b >= 11}>Every suggestion keeps its rule, inputs and constraint — so anyone can audit it later.</Pop>
      </div>
      <Sweep at={b >= 12} />
    </Shell>
  );
}
