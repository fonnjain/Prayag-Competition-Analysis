import { motion } from 'framer-motion';
import { C, Shell, Line, Pop, useBeats, serif, mono, sans, Sweep } from '../kit';

export function Scene1() {
  const b = useBeats([500, 1100, 3000, 4500, 5800, 7100, 9000, 10500, 12000, 17900]);
  const qs = ['Which rule?', 'Which evidence?', 'Who approved it?'];
  return (
    <Shell>
      <div className="absolute" style={{ left: '10%', top: '14%', ...serif, fontSize: '11vmin', lineHeight: 1 }}>
        <motion.div animate={{ opacity: b >= 7 ? 0 : 1, y: b >= 7 ? -40 : 0 }} transition={{ duration: 0.5 }}>
          <Line show={b >= 1}>Every price</Line>
          <Line show={b >= 2}><span style={{ fontStyle: 'italic', color: C.red }}>is a decision.</span></Line>
        </motion.div>
      </div>
      <div className="absolute" style={{ left: '10%', top: '14%', ...serif, fontSize: '9vmin', lineHeight: 1.02 }}>
        <Line show={b >= 7}>Two tools</Line>
        <Line show={b >= 7} delay={0.15}><span style={{ fontStyle: 'italic', color: C.red }}>show the working.</span></Line>
      </div>
      <motion.div className="absolute" style={{ right: '9%', top: '16%', rotate: -4 }}
        initial={{ scale: 2.2, opacity: 0 }} animate={b >= 3 && b < 8 ? { scale: 1, opacity: 1 } : { scale: b >= 8 ? 0.6 : 2.2, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 20 }}>
        <div style={{ background: C.ink, color: C.paper, padding: '4vmin 6vmin', borderRadius: '2vmin', ...mono, fontSize: '9vmin' }}>
          ₹ 1,240.00
          <div style={{ ...sans, fontSize: '2.2vmin', opacity: 0.7, marginTop: '1vmin' }}>suggested MRP · product 0417</div>
        </div>
      </motion.div>
      <div className="absolute flex flex-col gap-[2vmin]" style={{ left: '10%', top: '58%' }}>
        {qs.map((q, i) => (
          <Pop key={q} show={b >= 4 + i && b < 7} from={20}>
            <div style={{ ...serif, fontSize: '5vmin' }}><span style={{ ...mono, color: C.red, fontSize: '2.4vmin', marginRight: '2vmin' }}>0{i + 1}</span>{q}</div>
          </Pop>
        ))}
      </div>
      <div className="absolute flex gap-[4vmin]" style={{ left: '10%', top: '50%' }}>
        {[['MRP Generator', 'suggests prices from ordered rules', C.ink], ['Price Calculator', 'computes invoice totals exactly', C.teal]].map(([t, s, col], i) => (
          <motion.div key={t} initial={{ opacity: 0, y: 60, rotate: i ? 4 : -4 }}
            animate={b >= 8 + i * 0 ? { opacity: 1, y: 0, rotate: i ? 2 : -2 } : { opacity: 0, y: 60 }}
            transition={{ type: 'spring', stiffness: 200, damping: 22, delay: i * 0.35 }}
            style={{ width: '58vmin', padding: '4vmin', borderRadius: '2vmin', background: col as string, color: C.paper }}>
            <div style={{ ...serif, fontSize: '6vmin' }}>{t}</div>
            <div style={{ ...sans, fontSize: '3vmin', opacity: 0.8, marginTop: '1.5vmin' }}>{s}</div>
          </motion.div>
        ))}
      </div>
      <motion.div className="absolute" style={{ right: '9%', bottom: '10%', ...mono, fontSize: '2vmin', opacity: 0.6 }}
        animate={{ opacity: b >= 9 ? 0.7 : 0 }}>NO LLM SETS A PRICE IN EITHER TOOL</motion.div>
      <Sweep at={b >= 10} />
    </Shell>
  );
}
