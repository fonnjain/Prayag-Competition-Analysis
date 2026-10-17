import { motion } from 'framer-motion';
import { C, Shell, Line, Pop, useBeats, serif, mono, sans, Eyebrow, Sweep, Tag } from '../kit';

const ROWS = [
  ['1', 'Category · Pipes', 'Match Competitor A −2%'],
  ['2', 'Category · Fittings', 'Market median of quotes'],
  ['3', 'Category · Tanks', 'Hold current MRP'],
  ['4', 'Any product', 'Match lowest quote'],
  ['5', 'Fallback', 'No change'],
];
const RH = 11;

export function Scene2() {
  const b = useBeats([600, 2000, 3000, 4500, 7000, 9000, 10200, 11400, 14000, 18500]);
  const chip1y = b >= 4 ? 1 : b >= 2 ? 0 : -1;
  const chip2y = b >= 7 ? 1 : b >= 6 ? 0 : -1;
  return (
    <Shell>
      <Eyebrow n="01">MRP Generator · saved scenario</Eyebrow>
      <motion.div className="absolute" style={{ left: '10%', top: '17%', width: '50%' }}
        animate={b >= 10 ? { scaleY: 0.05, opacity: 0 } : {}} transition={{ duration: 0.8 }}>
        {ROWS.map((r, i) => {
          const hit1 = i === 1 && b >= 4 && b < 6;
          const hit2 = i === 1 && b >= 7;
          return (
            <motion.div key={r[0]} className="flex items-center" initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.15 * i + 0.2, duration: 0.5 }}
              style={{ height: `${RH}vmin`, borderBottom: `2px solid ${C.ink}22`, gap: '3vmin', background: hit1 ? `${C.teal}22` : hit2 ? `${C.amber}22` : 'transparent', paddingLeft: '2vmin' }}>
              <span style={{ ...mono, fontSize: '3vmin', color: C.red }}>{r[0]}</span>
              <span style={{ ...sans, fontSize: '3vmin', width: '30vmin' }}>{r[1]}</span>
              <span style={{ ...serif, fontSize: '3.4vmin' }}>{r[2]}</span>
            </motion.div>
          );
        })}
      </motion.div>
      {/* product chips */}
      <motion.div className="absolute" style={{ left: '61%', top: '17%' }}
        animate={{ y: chip1y < 0 ? '-30vmin' : chip1y === 0 ? (b >= 3 ? '0vmin' : '0vmin') : `${RH}vmin`, opacity: chip1y < 0 || b >= 6 ? 0 : 1 }}
        transition={{ type: 'spring', stiffness: 240, damping: 24 }}>
        <div style={{ background: C.ink, color: C.paper, padding: '2vmin 3vmin', borderRadius: '1.5vmin', ...mono, fontSize: '2.6vmin' }}>Product 0417 · Fittings</div>
        <div style={{ marginTop: '1.5vmin' }}>{b >= 3 && b < 4 && <Tag color={C.red}>row 1 · no match</Tag>}{b >= 4 && <Tag color={C.teal}>row 2 · match → stop</Tag>}</div>
      </motion.div>
      <motion.div className="absolute" style={{ left: '61%', top: '17%' }}
        animate={{ y: chip2y < 0 ? '-30vmin' : chip2y === 0 ? '0vmin' : `${RH}vmin`, opacity: chip2y < 0 || b >= 10 ? 0 : 1 }}
        transition={{ type: 'spring', stiffness: 240, damping: 24 }}>
        <div style={{ background: C.ink, color: C.paper, padding: '2vmin 3vmin', borderRadius: '1.5vmin', ...mono, fontSize: '2.6vmin' }}>Product 1182 · Fittings</div>
        <div style={{ marginTop: '1.5vmin' }}>{b >= 8 && <Tag color={C.amber}>no quotes → untouched</Tag>}</div>
      </motion.div>
      <div className="absolute" style={{ right: '7%', top: '50%', width: '30%', ...serif, fontSize: '8vmin', lineHeight: 1, textAlign: 'right' }}>
        <Line show={b >= 1}>First match</Line>
        <Line show={b >= 1} delay={0.15}><i style={{ color: C.red }}>wins.</i></Line>
      </div>
      <div className="absolute" style={{ left: '10%', bottom: '8%', ...sans, fontSize: '3.2vmin', width: '80%' }}>
        <Pop show={b >= 5 && b < 9}>Row order is the administrator’s pricing intent.</Pop>
      </div>
      <div className="absolute" style={{ left: '10%', bottom: '8%', ...sans, fontSize: '3.2vmin', width: '80%' }}>
        <Pop show={b >= 9}>Missing evidence never <b>falls through</b> to a broader rule.</Pop>
      </div>
      <Sweep at={b >= 10} />
    </Shell>
  );
}
