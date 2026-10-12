import { useEffect, useState } from 'react';
import { AnimatePresence, motion, animate, useMotionValue, useTransform } from 'framer-motion';
import { useSceneTimer } from '@/lib/video';
import { EASE, Eyebrow, Line, Ring, Sheet, shot } from './Sheet';
import type { TargetAndTransition } from 'framer-motion';
const ex = (o: object) => o as TargetAndTransition;

const full = 'absolute inset-0 overflow-hidden';

/* 1 — HOOK: 6,157 */
export function HookScene() {
  const n = useMotionValue(0);
  const txt = useTransform(n, (v) => Math.round(v).toLocaleString('en-US'));
  useEffect(() => { const c = animate(n, 6157, { duration: 1.4, delay: 0.2, ease: [0.16, 1, 0.3, 1] }); return () => c.stop(); }, [n]);
  return (
    <motion.section className={`${full} grain`} style={{ background: 'var(--ink)' }}
      exit={ex({ opacity: 0, transition: { duration: 0.35, delay: 0.25 } })}>
      <div style={{ position: 'absolute', left: '6%', top: '9%' }}><Eyebrow light>Pricing workspace · walkthrough</Eyebrow></div>
      <motion.div className="disp" exit={ex({ scale: 2.4, opacity: 0, transition: { duration: 0.55, ease: EASE } })}
        initial={{ scale: 1.25, opacity: 0, filter: 'blur(12px)' }} animate={{ scale: 1, opacity: 1, filter: 'blur(0px)' }} transition={{ duration: 0.6, ease: EASE }}
        style={{ position: 'absolute', left: '5%', bottom: '-6%', fontSize: '42vmin', fontWeight: 800, color: '#efe9dd', transformOrigin: '30% 70%' }}>
        <motion.span>{txt}</motion.span>
      </motion.div>
      <div style={{ position: 'absolute', right: '6%', top: '22%', textAlign: 'right' }}>
        <Line delay={1.0} size="9vmin" color="var(--sig)">products.</Line>
        <Line delay={2.0} size="5vmin" color="#efe9dd" style={{ marginTop: '3vmin' }}>One price record.</Line>
        <Line delay={2.9} size="5vmin" color="#efe9dd">Every competitor quote.</Line>
      </div>
      <motion.div initial={{ y: '100%' }} animate={{ y: '0%' }} transition={{ delay: 4.15, duration: 0.45, ease: [0.7, 0, 0.3, 1] }}
        style={{ position: 'absolute', inset: 0, background: 'var(--paper)' }} />
    </motion.section>
  );
}

/* 2 — CATALOG */
export function CatalogScene() {
  const [push, setPush] = useState(false);
  useSceneTimer([{ time: 1700, callback: () => setPush(true) }]);
  return (
    <motion.section className={`${full} grain`} style={{ background: 'var(--paper)', perspective: '160vmin' }}
      exit={ex({ opacity: 0, transition: { duration: 0.3, delay: 0.3 } })}>
      <div style={{ position: 'absolute', left: '5%', top: '8%', zIndex: 3 }}>
        <Eyebrow delay={0.1}>01 / Product database</Eyebrow>
        <Line delay={0.25} size="8vmin" style={{ marginTop: '2vmin' }}>Every MRP,</Line>
        <Line delay={0.4} size="8vmin" color="var(--sig)">in force.</Line>
        <motion.p className="mono" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.2 }}
          style={{ fontSize: '1.8vmin', color: 'var(--muted)', maxWidth: '34vmin', lineHeight: 1.6, marginTop: '3vmin' }}>
          Search, filter by division and category, export what is current.
        </motion.p>
      </div>
      <motion.div style={{ position: 'absolute', left: '40%', top: '12%', transformOrigin: '75% 40%' }}
        initial={{ rotateX: 22, rotateY: -18, scale: 0.85, y: '8vh', opacity: 0.4 }}
        animate={push ? { rotateX: 0, rotateY: 0, scale: 1.35, x: '-8vw', y: '6vh', opacity: 1 } : { rotateX: 6, rotateY: -8, scale: 0.95, y: 0, opacity: 1 }}
        exit={ex({ rotateY: 70, x: '-30vw', opacity: 0, transition: { duration: 0.6, ease: [0.7, 0, 0.3, 1] } })}
        transition={{ duration: push ? 1.2 : 0.9, ease: EASE }}>
        <Sheet src={shot('02-01-01')} width="58vw">
          {push && <Ring x={72} y={26} w={12} h={70} delay={0.7} label="Current MRP · effective dates" labelSide="bottom" />}
          {push && <Ring x={68.5} y={16} w={13.5} h={6} delay={1.5} label="Export MRP in force" />}
        </Sheet>
      </motion.div>
    </motion.section>
  );
}

/* 3 — COMPETITION ANALYSIS */
export function AnalysisScene() {
  const [pan, setPan] = useState(false);
  useSceneTimer([{ time: 2500, callback: () => setPan(true) }]);
  return (
    <motion.section className={`${full} grain`} style={{ background: 'var(--paper-2)', perspective: '160vmin' }}
      initial={{ clipPath: 'polygon(0 0, 0 0, 0 100%, 0 100%)' }} animate={{ clipPath: 'polygon(0 0, 100% 0, 100% 100%, 0 100%)' }}
      transition={{ duration: 0.6, ease: [0.7, 0, 0.3, 1] }}
      exit={ex({ opacity: 0, transition: { duration: 0.3, delay: 0.3 } })}>
      <div style={{ position: 'absolute', left: '-6%', top: '10%', width: '66%', height: '80%', overflow: 'hidden' }}>
        <motion.div initial={{ rotateY: 30, scale: 0.9, opacity: 0 }} animate={pan ? { rotateY: 0, scale: 1.25, y: '-22vh', opacity: 1 } : { rotateY: 8, scale: 1.05, y: 0, opacity: 1 }}
          transition={{ duration: pan ? 1.3 : 0.9, ease: EASE }} style={{ transformOrigin: '60% 30%', marginLeft: '8%' }}>
          <Sheet src={shot('03-01-03')} width="56vw">
            <Ring x={36} y={39} w={21} h={11} delay={0.9} label="Pricing position" />
            {pan && <Ring x={57.5} y={52} w={41} h={36} delay={0.6} label="Positioning distribution" labelSide="bottom" />}
          </Sheet>
        </motion.div>
      </div>
      <div style={{ position: 'absolute', right: '5%', top: '12%', width: '32%' }}>
        <Eyebrow delay={0.3}>Competition analysis</Eyebrow>
        <Line delay={0.9} size="20vmin" color="var(--sig)" style={{ marginTop: '2vmin' }}>64.4%</Line>
        <Line delay={1.2} size="4.2vmin">cheaper across</Line>
        <Line delay={1.35} size="4.2vmin">comparable SKUs.</Line>
        <motion.div className="mono" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 2.9, duration: 0.5 }}
          style={{ marginTop: '4vmin', fontSize: '1.9vmin', display: 'flex', gap: '1vmin' }}>
          <span style={{ background: 'var(--ink)', color: 'var(--paper)', padding: '0.8vmin 1.4vmin' }}>MRP-to-MRP</span>
          <span style={{ border: '1px solid var(--ink)', padding: '0.8vmin 1.4vmin' }}>Net-to-Net</span>
        </motion.div>
        <motion.div className="mono" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 3.3 }}
          style={{ fontSize: '1.6vmin', color: 'var(--muted)', marginTop: '1.4vmin' }}>Development capture · sample figures</motion.div>
      </div>
    </motion.section>
  );
}

/* 4 — MARKET COMPARISON word burst */
const WORDS = ['Undercut.', 'Matched.', 'Ahead.'];
export function CompareScene() {
  const [b, setB] = useState(0);
  useSceneTimer([{ time: 700, callback: () => setB(1) }, { time: 1350, callback: () => setB(2) }, { time: 2050, callback: () => setB(3) }]);
  return (
    <motion.section className={full} style={{ background: 'var(--ink)' }}
      exit={ex({ opacity: 0, transition: { duration: 0.3, delay: 0.3 } })}>
      <motion.div initial={{ scale: 1.5, opacity: 0 }} animate={b < 3 ? { scale: 1.3 + b * 0.08, opacity: 0.35 } : { scale: 0.62, x: '14vw', y: '4vh', opacity: 1, rotate: -2 }}
        exit={ex({ scale: 0.4, x: '-40vw', opacity: 0, transition: { duration: 0.55, ease: [0.7, 0, 0.3, 1] } })}
        transition={{ duration: b === 3 ? 0.9 : 0.5, ease: EASE }}
        style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Sheet src={shot('02-03-01')} width="90vw" dark>
          {b === 3 && <Ring x={50} y={30} w={48} h={50} delay={0.8} label="Competitor prices · % gap" />}
        </Sheet>
      </motion.div>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
        <AnimatePresence mode="sync">
          {b < 3 && (
            <motion.div key={b} className="disp" initial={{ scale: 1.6, opacity: 0, filter: 'blur(10px)' }} animate={{ scale: 1, opacity: 1, filter: 'blur(0px)' }}
              exit={ex({ scale: 0.75, opacity: 0, transition: { duration: 0.15 } })} transition={{ type: 'spring', stiffness: 320, damping: 26 }}
              style={{ position: 'absolute', fontSize: '24vmin', fontWeight: 800, color: b === 0 ? 'var(--sig)' : '#efe9dd' }}>{WORDS[b]}</motion.div>
          )}
        </AnimatePresence>
      </div>
      {b === 3 && (
        <div style={{ position: 'absolute', left: '5%', top: '14%', width: '30%' }}>
          <Eyebrow light>Market comparison</Eyebrow>
          <Line delay={0.1} size="7vmin" color="#efe9dd" style={{ marginTop: '2vmin' }}>The gap,</Line>
          <Line delay={0.25} size="7vmin" color="var(--sig)">product by</Line>
          <Line delay={0.4} size="7vmin" color="var(--sig)">product.</Line>
          <motion.p className="mono" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.1 }}
            style={{ color: '#a9ada2', fontSize: '1.7vmin', lineHeight: 1.6, marginTop: '3vmin' }}>By product · by competitor row · category win rates</motion.p>
        </div>
      )}
    </motion.section>
  );
}

/* 5 — MRP GENERATOR */
export function GeneratorScene() {
  const [s, setS] = useState(0);
  useSceneTimer([{ time: 1900, callback: () => setS(1) }, { time: 4300, callback: () => setS(2) }]);
  return (
    <motion.section className={`${full} grain`} style={{ background: 'var(--paper)', perspective: '170vmin' }}
      initial={{ clipPath: 'circle(0% at 30% 50%)' }} animate={{ clipPath: 'circle(150% at 30% 50%)' }} transition={{ duration: 0.7, ease: EASE }}
      exit={ex({ opacity: 0, transition: { duration: 0.3, delay: 0.3 } })}>
      <div style={{ position: 'absolute', left: '5%', bottom: '10%', width: '34%', zIndex: 5 }}>
        <Eyebrow delay={0.3}>02 / MRP generator</Eyebrow>
        <Line delay={0.5} size="7.5vmin" style={{ marginTop: '2vmin' }}>Propose prices.</Line>
        <Line delay={0.7} size="7.5vmin" color="var(--sig)">Show the evidence.</Line>
      </div>
      <motion.div initial={{ scale: 0.8, rotateY: -20, opacity: 0 }} animate={s === 0 ? { scale: 0.95, rotateY: -10, opacity: 1 } : { scale: 0.82, rotateY: -16, x: '-6vw', y: '-6vh', opacity: 0.55 }}
        transition={{ duration: 0.9, ease: EASE }} style={{ position: 'absolute', right: '8%', top: '8%' }}>
        <Sheet src={shot('04-01-overview')} width="52vw">
          {s === 0 && <Ring x={2} y={34} w={60} h={30} delay={0.9} label="Saved scenarios · recent runs" />}
        </Sheet>
      </motion.div>
      {s >= 1 && (
        <motion.div initial={{ z: 600, rotateY: 18, opacity: 0 }} animate={s === 2 ? { z: 120, rotateY: 0, opacity: 1, scale: 1.25 } : { z: 0, rotateY: -6, opacity: 1 }}
          transition={{ duration: s === 2 ? 0.8 : 0.9, ease: EASE }} style={{ position: 'absolute', right: '3%', top: '24%', transformOrigin: '60% 50%' }}>
          <Sheet src={shot('04-04-04')} width="50vw">
            <Ring x={4} y={20} w={92} h={50} delay={0.8} label="Value & action distribution" labelSide="bottom" />
          </Sheet>
        </motion.div>
      )}
    </motion.section>
  );
}

/* 6 — PRICE FINDER */
export function FinderScene() {
  const [s, setS] = useState(0);
  useSceneTimer([{ time: 2000, callback: () => setS(1) }]);
  return (
    <motion.section className={`${full} grain`} style={{ background: 'var(--sig)', perspective: '160vmin' }}
      initial={{ y: '100%' }} animate={{ y: '0%' }} transition={{ duration: 0.55, ease: [0.7, 0, 0.3, 1] }}
      exit={ex({ opacity: 0, transition: { duration: 0.3, delay: 0.35 } })}>
      <div style={{ position: 'absolute', right: '5%', top: '10%', width: '34%', textAlign: 'right' }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}><Eyebrow delay={0.4}>03 / Price finder</Eyebrow></div>
        <Line delay={0.55} size="8vmin" style={{ marginTop: '2vmin' }}>Look up</Line>
        <Line delay={0.7} size="8vmin" color="var(--paper)">any product.</Line>
        <AnimatePresence>
          {s === 1 && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <Line delay={0.2} size="5vmin" style={{ marginTop: '3vmin' }}>Compare in seconds.</Line>
          </motion.div>}
        </AnimatePresence>
      </div>
      <motion.div initial={{ x: '-20vw', rotate: -8, opacity: 0 }} animate={s === 0 ? { x: 0, rotate: -3, opacity: 1 } : { x: '-3vw', y: '-12vh', rotate: -6, scale: 0.85, opacity: 1 }}
        exit={ex({ scale: 0.3, x: '-10vw', y: '-30vh', opacity: 0, transition: { duration: 0.6, ease: EASE } })}
        transition={{ duration: 0.8, ease: EASE }} style={{ position: 'absolute', left: '5%', top: '14%' }}>
        <Sheet src={shot('05-01-03')} width="52vw">
          {s === 0 && <Ring x={18} y={30} w={64} h={30} delay={0.9} label="Product price details" />}
        </Sheet>
      </motion.div>
      {s === 1 && (
        <motion.div initial={{ y: '60vh', rotate: 6 }} animate={{ y: 0, rotate: 2 }} exit={ex({ scale: 0.3, y: '30vh', opacity: 0, transition: { duration: 0.6, ease: EASE } })}
          transition={{ duration: 0.8, ease: EASE }} style={{ position: 'absolute', left: '14%', top: '34%' }}>
          <Sheet src={shot('05-02-01')} width="50vw">
            <Ring x={20} y={25} w={60} h={40} delay={0.8} label="Side-by-side comparison" labelSide="bottom" />
          </Sheet>
        </motion.div>
      )}
    </motion.section>
  );
}

/* 7 — FINALE wall + lockup */
const WALL = ['01-sign-in', '02-01-01', '02-03-01', '03-01-03', '03-01-07', '04-01-overview', '04-04-04', '05-01-03', '05-02-01'];
export function FinaleScene() {
  const [s, setS] = useState(0);
  useSceneTimer([{ time: 2300, callback: () => setS(1) }]);
  return (
    <motion.section className={full} style={{ background: 'var(--paper)', perspective: '180vmin' }}
      exit={ex({ opacity: 0, transition: { duration: 0.4 } })}>
      <motion.div initial={{ scale: 2.2, rotateX: 0 }} animate={{ scale: s ? 0.9 : 1, rotateX: 18, rotateZ: -6 }} transition={{ duration: s ? 2.6 : 2.2, ease: EASE }}
        style={{ position: 'absolute', inset: '-10%', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '2.4vmin', alignContent: 'center', padding: '4vmin' }}>
        {WALL.map((f, i) => (
          <motion.div key={f} initial={{ opacity: 0, z: 500 }} animate={{ opacity: 1, z: 0 }} transition={{ delay: 0.08 * i, duration: 0.7, ease: EASE }}>
            <Sheet src={shot(f)} width="100%" />
          </motion.div>
        ))}
      </motion.div>
      <motion.div initial={{ clipPath: 'circle(0% at 50% 50%)' }} animate={s ? { clipPath: 'circle(75% at 50% 50%)' } : {}}
        transition={{ duration: 0.8, ease: EASE }} className="grain"
        style={{ position: 'absolute', inset: 0, background: 'var(--ink)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        {s === 1 && <>
          <Line delay={0.35} size="13vmin" color="#efe9dd">Price with</Line>
          <Line delay={0.5} size="13vmin" color="var(--sig)">evidence.</Line>
          <motion.div className="mono" initial={{ opacity: 0, letterSpacing: '0.5em' }} animate={{ opacity: 1, letterSpacing: '0.18em' }} transition={{ delay: 1.1, duration: 0.8, ease: EASE }}
            style={{ color: '#efe9dd', fontSize: '2.1vmin', marginTop: '4vmin' }}>Catalogue · Comparison · Generator · Finder</motion.div>
        </>}
      </motion.div>
    </motion.section>
  );
}
