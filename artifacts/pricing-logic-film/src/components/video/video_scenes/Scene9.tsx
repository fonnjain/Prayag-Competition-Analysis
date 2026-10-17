import { motion } from 'framer-motion';
import { C, Shell, Line, Pop, useBeats, serif, mono, sans, Eyebrow, Tag } from '../kit';

export function Scene9() {
  const b = useBeats([400, 1400, 2600, 3800, 5200, 7000, 8400, 9800, 11400, 13200, 14400]);
  const inv = b >= 9;
  return (
    <Shell>
      <motion.div className="absolute inset-0" style={{ background: C.ink, transformOrigin: 'bottom' }} initial={{ scaleY: 0 }} animate={{ scaleY: inv ? 1 : 0 }} transition={{ duration: 0.9, ease: [0.7, 0, 0.2, 1] }} />
      <motion.div animate={{ opacity: inv ? 0 : 1 }} transition={{ duration: 0.5 }}>
        <Eyebrow n="08">Where AI actually helps</Eyebrow>
        <div className="absolute" style={{ left: '10%', top: '16%', width: '30%', height: '62%', background: '#F7F2E6', borderRadius: '1vmin', boxShadow: `0 2vmin 5vmin ${C.ink}22`, overflow: 'hidden', padding: '3vmin' }}>
          {Array.from({ length: 11 }, (_, i) => <div key={i} style={{ height: '1.4vmin', margin: '2.2vmin 0', width: `${60 + ((i * 37) % 35)}%`, background: `${C.ink}22`, borderRadius: 4 }} />)}
          <motion.div className="absolute left-0 right-0" style={{ height: '6vmin', background: `linear-gradient(${C.red}00, ${C.red}55)`, top: 0 }}
            animate={b >= 1 ? { y: ['0vmin', '62vmin', '0vmin'] } : {}} transition={{ duration: 3, ease: 'easeInOut' }} />
          <div style={{ position: 'absolute', bottom: '2vmin', left: '3vmin', ...mono, fontSize: '1.9vmin', opacity: 0.6 }}>competitor price list · PDF</div>
        </div>
        <div className="absolute" style={{ left: '46%', top: '16%', width: '46%' }}>
          {[['Row 14 · 32 mm elbow · 118.00', 'match → Product 0417', 2], ['Row 15 · 40 mm tee · 164.50', 'match → Product 0522', 3], ['Row 16 · unreadable code', 'needs a person', 4]].map(([r, m, s], i) => (
            <Pop key={r as string} show={b >= (s as number)}>
              <div style={{ padding: '2vmin 0', borderBottom: `2px solid ${C.ink}22` }}>
                <div style={{ ...mono, fontSize: '2.4vmin' }}>{r}</div>
                <div className="flex items-center" style={{ gap: '1.5vmin', marginTop: '1vmin' }}>
                  <Tag color={i === 2 ? C.amber : C.mute}>AI suggests: {m}</Tag>
                  {b >= 5 && i < 2 && <Tag color={C.teal}>reviewer approved</Tag>}
                </div>
              </div>
            </Pop>
          ))}
          <div className="flex" style={{ marginTop: '4vmin', gap: '2vmin' }}>
            {[['AI', 'reads & suggests', C.mute], ['Rules', 'decide prices', C.red], ['Maths', 'exact to the paisa', C.teal]].map(([t, d, col], i) => (
              <Pop key={t} show={b >= 6 + i} style={{ flex: 1 }}>
                <div style={{ borderLeft: `0.8vmin solid ${col}`, paddingLeft: '2vmin' }}>
                  <div style={{ ...serif, fontSize: '4.4vmin' }}>{t}</div>
                  <div style={{ ...sans, fontSize: '2.3vmin', opacity: 0.75 }}>{d}</div>
                </div>
              </Pop>
            ))}
          </div>
        </div>
      </motion.div>
      <div className="absolute" style={{ left: '10%', top: '30%', ...serif, fontSize: '13vmin', lineHeight: 1, color: C.paper }}>
        <Line show={inv} delay={0.4}>Rules decide.</Line>
        <Line show={b >= 10}><i style={{ color: C.red }}>People approve.</i></Line>
      </div>
      <motion.div className="absolute" style={{ left: '10%', bottom: '12%', ...mono, fontSize: '2.2vmin', letterSpacing: '0.16em', color: C.paper }}
        initial={{ opacity: 0 }} animate={{ opacity: b >= 11 ? 0.7 : 0 }}>MRP GENERATOR · PRICE CALCULATOR · EVERY NUMBER TRACEABLE</motion.div>
    </Shell>
  );
}
