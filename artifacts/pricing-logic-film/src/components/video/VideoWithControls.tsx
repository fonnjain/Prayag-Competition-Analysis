import { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Pause, Repeat, Volume2, VolumeX, ChevronDown, ChevronUp } from 'lucide-react';
import VideoTemplate, { SCENE_DURATIONS } from './VideoTemplate';
import { useSceneControls } from './useSceneControls';
import { SCENE_DETAILS } from './sceneMeta';

function announce(index: number, keys: string[]) {
  const d = SCENE_DETAILS[keys[index]]; if (!d?.filePath) return;
  window.parent.postMessage({ type: 'REPLIT_VIDEO_SCENE_SELECTED', payload: { sceneIndex: index, sceneCount: keys.length, sceneTitle: d.title, filePath: d.filePath, lineNumber: 1 } }, '*');
}
const fmtT = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`; };

function Status({ keys, active, dur, start, total, tick, paused, onJump }: { keys: string[]; active: number; dur: number; start: number; total: number; tick: number; paused: boolean; onJump: (i: number) => void }) {
  const [el, setEl] = useState(0); const base = useRef(0);
  useEffect(() => { setEl(0); base.current = 0; }, [tick]);
  useEffect(() => {
    if (paused) return; const s = performance.now();
    const id = window.setInterval(() => setEl(base.current + performance.now() - s), 60);
    return () => { window.clearInterval(id); base.current += performance.now() - s; };
  }, [tick, paused]);
  const prog = dur > 0 ? Math.min(1, el / dur) : 0;
  const tot = Math.min(total, start + Math.min(el, dur));
  return (<>
    <div className="flex-1 flex items-center gap-1.5">
      {keys.map((k, i) => (
        <button key={k} onClick={() => onJump(i)} aria-label={`Jump to scene ${i + 1}`} className="flex-1 h-3 bg-white/20 rounded-full overflow-hidden relative hover:h-4 transition-all min-h-[12px]">
          <div className="absolute inset-y-0 left-0 bg-white/90 rounded-full" style={{ width: `${i === active ? prog * 100 : 0}%` }} />
        </button>
      ))}
    </div>
    <div className="text-xl text-white/60 font-mono tabular-nums shrink-0">{active + 1}/{keys.length}</div>
    <div className="min-w-[11ch] text-right text-xl text-white/80 font-mono tabular-nums shrink-0" role="timer">{fmtT(tot)} / {fmtT(total)}</div>
  </>);
}

export default function VideoWithControls() {
  const isIframed = typeof window !== 'undefined' && window.self !== window.top;
  const c = useSceneControls(SCENE_DURATIONS);
  const [muted, setMuted] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [tapPinned, setTapPinned] = useState(false);
  const sensorRef = useRef<HTMLDivElement | null>(null);
  const { jumpTo, sceneKeys } = c;
  const handleJump = useCallback((i: number) => { jumpTo(i); announce(i, sceneKeys); }, [jumpTo, sceneKeys]);
  useEffect(() => {
    if (!c.paused) return;
    const f = document.getAnimations().filter(a => a.playState === 'running'); f.forEach(a => a.pause());
    return () => f.forEach(a => a.play());
  }, [c.paused]);
  useEffect(() => {
    if (!(collapsed && tapPinned)) return;
    const h = (e: PointerEvent) => { if (e.pointerType === 'mouse') return; if (sensorRef.current && !sensorRef.current.contains(e.target as Node)) setTapPinned(false); };
    document.addEventListener('pointerdown', h); return () => document.removeEventListener('pointerdown', h);
  }, [collapsed, tapPinned]);
  if (!isIframed) return <VideoTemplate />;
  const visible = !collapsed || hovering || tapPinned;
  const btn = 'w-14 h-14 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-colors rounded-lg shrink-0';
  return (
    <div className="relative w-full h-screen">
      <VideoTemplate key={c.mountKey} durations={c.durations} loop paused={c.paused} muted={muted} onSceneChange={c.onSceneChange} />
      <div ref={sensorRef} className="absolute bottom-0 left-0 right-0 z-50 flex flex-col justify-end" style={{ height: '25%' }}
        onPointerEnter={e => e.pointerType === 'mouse' && setHovering(true)} onPointerLeave={e => e.pointerType === 'mouse' && setHovering(false)}
        onPointerDown={e => { if (e.pointerType !== 'mouse' && collapsed) setTapPinned(true); }}>
        <div className="flex-1 w-full" aria-hidden="true" />
        <div className={`flex items-center gap-3 bg-black/50 backdrop-blur-sm px-5 py-4 transition-all duration-200 ${visible ? 'translate-y-0 opacity-100 pointer-events-auto' : 'translate-y-full opacity-0 pointer-events-none'}`}>
          <button className={btn} onClick={c.togglePause} aria-label={c.paused ? 'Play' : 'Pause'}>{c.paused ? <Play className="w-8 h-8" /> : <Pause className="w-8 h-8" />}</button>
          <button className={`${btn} ${c.locked ? 'bg-white/15 text-white' : ''}`} onClick={c.toggleLock} aria-pressed={c.locked} aria-label="Loop current scene"><Repeat className="w-8 h-8" /></button>
          <button className={btn} onClick={() => setMuted(m => !m)} aria-label={muted ? 'Unmute' : 'Mute'}>{muted ? <VolumeX className="w-8 h-8" /> : <Volume2 className="w-8 h-8" />}</button>
          <div className="w-px self-stretch bg-white/15" />
          <Status keys={c.sceneKeys} active={c.activeIndex} dur={c.activeDuration} start={c.activeStartTime} total={c.totalDuration} tick={c.tick} paused={c.paused} onJump={handleJump} />
          <button className={btn} onClick={() => setCollapsed(v => { if (!v) { setHovering(false); setTapPinned(false); } return !v; })} aria-label="Toggle controls">
            {collapsed ? <ChevronUp className="w-10 h-10" /> : <ChevronDown className="w-10 h-10" />}
          </button>
        </div>
      </div>
    </div>
  );
}
