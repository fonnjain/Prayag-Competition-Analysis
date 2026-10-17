import { motion } from 'framer-motion';
import { C, Shell, Pop, useBeats, serif, mono, sans, Eyebrow, Sweep, Tag, fmt, useCount } from '../kit';

export function Scene8() {
  const b = useBeats([400, 1600, 2800, 4000, 6200, 8600, 10000, 11400, 13800, 18500]);
  const o = useCount(0, 4250.0, 1600, 900);
  const a = useCount(0, 4071.5, 2800, 900);
  const c = useCount(0, 4492.8, 4000, 900);
  const cols = [
    { n: 'Ours', d: '15% off', v: o, tag: null as null | [string, string], show: 2, col: C.ink },
    { n: 'Competitor A', d: '22% off', v: a, tag: ['4.2% below us', C.teal] as [string, string], show: 3, col: C.teal },
    { n: 'Competitor B', d: '10% off', v: c, tag: ['5.7% above us', C.red] as [string, string], show: 4, col: C.red },
  ];
  return (
    <Shell>
      <Eyebrow n="07">Compare on equal terms</Eyebrow>
      <motion.div className="absolute" style={{ left: '10%', top: '13%', ...serif, fontSize: '6.5vmin' }} initial={{ opacity: 0 }} animate={{ opacity: b >= 1 ? 1 : 0 }}>
        Each side gets <i style={{ color: C.red }}>its own discount.</i>
      </motion.div>
      <div className="absolute flex" style={{ left: '10%', right: '8%', top: '30%', gap: '3vmin' }}>
        {cols.map((k, i) => (
          <Pop key={k.n} show={b >= k.show} style={{ flex: i === 0 ? 1.2 : 1 }}>
            <div style={{ borderTop: `1vmin solid ${k.col}`, background: '#F7F2E6', padding: '3vmin', borderRadius: '0 0 1.5vmin 1.5vmin', minHeight: '34vmin' }}>
              <div style={{ ...serif, fontSize: '4vmin' }}>{k.n}</div>
              <div style={{ ...mono, fontSize: '2.4vmin', opacity: 0.6 }}>{k.d} · qty 50</div>
              <div style={{ ...mono, fontSize: '6vmin', marginTop: '2vmin' }}>{fmt(k.v)}</div>
              <div style={{ marginTop: '2vmin', minHeight: '4vmin' }}>{k.tag && b >= 5 && <Tag color={k.tag[1]}>{k.tag[0]}</Tag>}</div>
              <div style={{ marginTop: '1.4vmin', ...sans, fontSize: '2.2vmin' }}>
                {i === 1 && b >= 6 && <span style={{ color: C.mute }}>Competitor unit not recorded · info only</span>}
                {i === 2 && b >= 7 && <span style={{ color: C.amber, fontWeight: 600 }}>Units differ: competitor 3 m; ours each</span>}
                {i === 0 && b >= 6 && <span style={{ color: C.teal }}>Basis checked: MRP vs MRP</span>}
              </div>
            </div>
          </Pop>
        ))}
      </div>
      <motion.div className="absolute flex items-center" style={{ left: '10%', right: '8%', bottom: '8%', background: C.ink, color: C.paper, borderRadius: '1.5vmin', padding: '2.4vmin 3vmin', gap: '4vmin', ...mono, fontSize: '2.4vmin' }}
        initial={{ y: 80, opacity: 0 }} animate={b >= 8 ? { y: 0, opacity: 1 } : {}} transition={{ type: 'spring', stiffness: 200, damping: 24 }}>
        <span>3 products</span><span>142 pcs</span><span>2 competitors</span><span style={{ color: C.amber }}>1 unit warning</span>
        <span style={{ marginLeft: 'auto' }}>Export · scoped .xlsx</span>
      </motion.div>
      <motion.div className="absolute" style={{ right: '8%', top: '15%', ...sans, fontSize: '2.2vmin', opacity: 0.7 }} animate={{ opacity: b >= 9 ? 0.8 : 0 }}>
        Only products and quotes your bucket allows.
      </motion.div>
      <Sweep at={b >= 10} />
    </Shell>
  );
}
