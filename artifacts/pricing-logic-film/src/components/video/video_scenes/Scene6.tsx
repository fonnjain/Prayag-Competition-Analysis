import { motion } from 'framer-motion';
import { C, Shell, Line, Pop, useBeats, serif, mono, sans, Eyebrow, Sweep } from '../kit';

const FLOW = ['Run', 'Reviewer selects', 'Revision preview', 'Re-check current row', 'Approve & apply'];

export function Scene6() {
  const b = useBeats([400, 3600, 4800, 6000, 7200, 8400, 10200, 12400, 15000, 18500]);
  return (
    <Shell bg={C.paper2}>
      <Eyebrow n="05">Handoff to people</Eyebrow>
      <motion.div className="absolute" style={{ left: '10%', top: '14%', ...serif, fontSize: '10vmin', lineHeight: 1 }}
        animate={{ scale: b >= 2 ? 0.6 : 1, x: 0, y: b >= 2 ? '-4vmin' : 0 }} transition={{ duration: 0.8 }} >
        <div style={{ transformOrigin: 'left top' }}>
          <Line show={b >= 1}>A run writes</Line>
          <Line show={b >= 1} delay={0.15}><i style={{ color: C.red }}>no prices.</i></Line>
        </div>
      </motion.div>
      <div className="absolute flex items-center" style={{ left: '6%', right: '6%', top: '46%', gap: '1.4vmin' }}>
        {FLOW.map((f, i) => {
          const stale = i === 3 && b >= 7 && b < 8;
          return (
            <div key={f} className="flex items-center" style={{ gap: '1.4vmin', flex: 1 }}>
              <Pop show={b >= 2 + i} style={{ flex: 1 }}>
                <motion.div animate={{ background: stale ? C.amber : i === 4 && b >= 8 ? C.teal : C.ink }}
                  style={{ color: C.paper, padding: '3vmin 2vmin', borderRadius: '1.6vmin', ...sans, fontSize: '2.7vmin', textAlign: 'center', minHeight: '14vmin', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {f}
                </motion.div>
              </Pop>
              {i < 4 && <motion.div style={{ width: '2.5vmin', height: 3, background: C.red }} initial={{ scaleX: 0 }} animate={{ scaleX: b >= 3 + i ? 1 : 0 }} />}
            </div>
          );
        })}
      </div>
      <div className="absolute" style={{ left: '52%', top: '66%', ...mono, fontSize: '2.4vmin', color: C.amber, width: '40%' }}>
        <Pop show={b >= 7 && b < 8}>Value changed since the run → preview rejected as stale.</Pop>
      </div>
      <div className="absolute" style={{ left: '52%', top: '66%', ...mono, fontSize: '2.4vmin', color: C.teal, width: '40%' }}>
        <Pop show={b >= 8}>Same approved row, same value, one effective date → applied.</Pop>
      </div>
      <div className="absolute" style={{ left: '10%', bottom: '9%', ...serif, fontSize: '5vmin' }}>
        <Pop show={b >= 9}>Human approval, <i style={{ color: C.red }}>every time.</i></Pop>
      </div>
      <div className="absolute" style={{ right: '8%', bottom: '10%', ...sans, fontSize: '2.2vmin', width: '30%', textAlign: 'right', opacity: 0.75 }}>
        <Pop show={b >= 9}>Portfolio margin targets are reported, never auto-solved.</Pop>
      </div>
      <Sweep at={b >= 10} />
    </Shell>
  );
}
