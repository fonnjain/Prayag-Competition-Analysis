import { motion } from 'framer-motion';
import { C, Shell, Pop, useBeats, serif, mono, sans, Eyebrow, Sweep, fmt, useCount } from '../kit';

function Term({ show, label, value, color = C.ink }: { show: boolean; label: string; value: string; color?: string }) {
  return (
    <Pop show={show} from={30}>
      <div className="flex flex-col items-center" style={{ gap: '1vmin' }}>
        <div style={{ ...mono, fontSize: '6.5vmin', color }}>{value}</div>
        <div style={{ ...sans, fontSize: '2.3vmin', opacity: 0.7 }}>{label}</div>
      </div>
    </Pop>
  );
}
const Op = ({ show, t }: { show: boolean; t: string }) => <Pop show={show}><div style={{ ...serif, fontSize: '6vmin', opacity: 0.5 }}>{t}</div></Pop>;

export function Scene4() {
  const b = useBeats([400, 1600, 2800, 4200, 5600, 7000, 8400, 10200, 12000, 13800, 15600, 18500]);
  const sale = useCount(0, 1030.69, 4200, 900);
  const mrp = useCount(0, 1263.10, 8400, 1100);
  return (
    <Shell>
      <Eyebrow n="03">Optional margin floor · opt-in</Eyebrow>
      <motion.div className="absolute" style={{ left: '10%', top: '14%', ...serif, fontSize: '7vmin' }}
        initial={{ opacity: 0 }} animate={{ opacity: b >= 1 ? 1 : 0 }}>
        The floor is <i style={{ color: C.red }}>arithmetic</i>, not a hunch.
      </motion.div>
      <div className="absolute flex items-center justify-center" style={{ left: 0, right: 0, top: '33%', gap: '3vmin' }}>
        <Term show={b >= 2} label="unit BOM (per piece)" value="742.10" />
        <Op show={b >= 3} t="÷ (1 −" />
        <Term show={b >= 3} label="category floor" value="28%" color={C.teal} />
        <Op show={b >= 3} t=")" />
        <Op show={b >= 4} t="=" />
        <Term show={b >= 4} label="required realised sale" value={fmt(sale)} />
      </div>
      <div className="absolute flex items-center justify-center" style={{ left: 0, right: 0, top: '56%', gap: '3vmin' }}>
        <Term show={b >= 5} label="required sale" value="1,030.69" />
        <Op show={b >= 6} t="÷ (1 −" />
        <Term show={b >= 6} label="observed discount" value="18.4%" color={C.amber} />
        <Op show={b >= 6} t=")" />
        <Op show={b >= 7} t="=" />
        <Term show={b >= 7} label="minimum MRP" value={fmt(mrp)} color={C.red} />
      </div>
      <div className="absolute flex items-center" style={{ left: '10%', bottom: '9%', gap: '4vmin' }}>
        <Pop show={b >= 8}><div style={{ ...sans, fontSize: '3vmin' }}>Competitive target <span style={{ ...mono }}>1,239.00</span></div></Pop>
        <Pop show={b >= 9}>
          <motion.div animate={b >= 9 ? { rotate: [-12, -4] , scale: [1.6, 1] } : {}} transition={{ type: 'spring', stiffness: 300, damping: 14 }}
            style={{ border: `4px solid ${C.red}`, color: C.red, padding: '1.5vmin 3vmin', ...mono, fontSize: '3.4vmin', fontWeight: 600 }}>
            FLOOR BINDS · 1,263.10
          </motion.div>
        </Pop>
      </div>
      <div className="absolute" style={{ right: '8%', bottom: '9%', width: '30%', ...sans, fontSize: '2.4vmin', textAlign: 'right' }}>
        <Pop show={b >= 10}>No usable quantity, BOM or discount evidence? The product is <b>excluded</b>, never estimated.</Pop>
      </div>
      <Sweep at={b >= 12} />
    </Shell>
  );
}
