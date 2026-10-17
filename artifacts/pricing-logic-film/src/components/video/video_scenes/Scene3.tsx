import { motion } from 'framer-motion';
import { C, Shell, Pop, useBeats, serif, mono, sans, Eyebrow, Sweep, fmt, Line } from '../kit';

const ST = [
  ['Current MRP', 1180, ''],
  ['Competitor A quote', 1265, 'evidence'],
  ['Target −2%', 1239.7, 'rule 1'],
  ['Hold?', 1239.7, 'not held'],
  ['Cap +5%', 1239, 'cap binds'],
  ['Round to …9', 1239, 'kept'],
] as const;

export function Scene3() {
  const b = useBeats([400, 2400, 4600, 6800, 9000, 11200, 13400, 15200, 18500]);
  const active = Math.min(Math.max(b - 1, 0), 5);
  const val = ST[active][1];
  return (
    <Shell>
      <Eyebrow n="02">From evidence to suggestion</Eyebrow>
      <div className="absolute" style={{ left: '10%', top: '14%', ...serif, fontSize: '7vmin' }}>
        <Line show={b >= 1}>One product, <i style={{ color: C.red }}>six checkpoints.</i></Line>
      </div>
      <motion.div className="absolute" style={{ right: '9%', top: '13%', ...mono, fontSize: '10vmin', color: b >= 6 ? C.red : C.ink }}
        key={active} initial={{ y: -20, opacity: 0.3 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.35 }}>
        {fmt(val)}
      </motion.div>
      <svg className="absolute" style={{ left: '8%', top: '52%', width: '84%', height: '4vmin' }} viewBox="0 0 100 4" preserveAspectRatio="none">
        <line x1="0" x2="100" y1="2" y2="2" stroke={C.ink} strokeOpacity={0.2} strokeWidth={0.4} />
        <motion.line x1="0" y1="2" y2="2" stroke={C.red} strokeWidth={0.6} animate={{ x2: b >= 1 ? 8 + active * 16.8 : 0 }} transition={{ duration: 0.8, ease: 'easeInOut' }} />
      </svg>
      <div className="absolute flex" style={{ left: '8%', width: '84%', top: '42%' }}>
        {ST.map((s, i) => {
          const on = b >= i + 2 || (i === 0 && b >= 1);
          const cur = i === active && b >= 1;
          return (
            <div key={s[0]} className="flex-1 flex flex-col items-center" style={{ gap: '2vmin' }}>
              <motion.div animate={{ scale: cur ? 1.25 : 1, background: on ? (i === 4 ? C.red : C.ink) : C.paper2 }}
                style={{ width: '5vmin', height: '5vmin', borderRadius: 999, border: `3px solid ${C.ink}`, marginTop: '6vmin' }} />
              <div style={{ ...sans, fontSize: '2.5vmin', textAlign: 'center', opacity: on ? 1 : 0.35 }}>{s[0]}</div>
              <div style={{ ...mono, fontSize: '2.3vmin', opacity: on ? 1 : 0.2 }}>{fmt(s[1])}</div>
              <div style={{ ...mono, fontSize: '1.9vmin', color: i === 4 ? C.red : C.teal, opacity: on ? 1 : 0 }}>{s[2]}</div>
            </div>
          );
        })}
      </div>
      <div className="absolute" style={{ left: '10%', bottom: '9%', ...serif, fontSize: '4.4vmin', width: '80%' }}>
        <Pop show={b >= 8}>Once a limit binds, <i style={{ color: C.red }}>later rules can’t relax it.</i></Pop>
      </div>
      <motion.div className="absolute" style={{ left: '10%', bottom: '20%', ...sans, fontSize: '2.6vmin', opacity: 0.7 }}
        animate={{ opacity: b >= 7 ? 0.75 : 0 }}>Hold, change cap and rounding are applied in order — deterministically, every run.</motion.div>
      <Sweep at={b >= 9} />
    </Shell>
  );
}
