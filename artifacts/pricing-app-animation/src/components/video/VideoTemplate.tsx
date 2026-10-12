import { useEffect, useRef } from 'react';
import type React from 'react';
import { VideoCanvas, VideoPausedContext, type VideoAspectRatio, useVideoPlayer } from '@/lib/video';
import { AnimatePresence } from 'framer-motion';
import { AnalysisScene, CatalogScene, CompareScene, FinaleScene, FinderScene, GeneratorScene, HookScene } from './Scenes';

// Cuts sit on measured music onsets: 4.60, 9.15, 14.00, 18.30, 23.40, 28.00 s.
export const SCENE_DURATIONS = {
  hook: 4600,
  catalog: 4550,
  analysis: 4850,
  compare: 4300,
  generator: 5100,
  finder: 4600,
  finale: 5000,
};

const SCENE_COMPONENTS: Record<string, React.ComponentType> = {
  hook: HookScene, catalog: CatalogScene, analysis: AnalysisScene, compare: CompareScene,
  generator: GeneratorScene, finder: FinderScene, finale: FinaleScene,
};

const VIDEO_ASPECT_RATIO: VideoAspectRatio = '16:9';

const SCENE_START_SEC: Record<string, number> = (() => {
  const out: Record<string, number> = {};
  let c = 0;
  for (const [k, ms] of Object.entries(SCENE_DURATIONS)) { out[k] = c / 1000; c += ms; }
  return out;
})();
const AUDIO_SEEK_EPSILON_SEC = 0.18;

export default function VideoTemplate({
  durations = SCENE_DURATIONS, loop = true, paused = false, muted = false, onSceneChange,
}: {
  durations?: Record<string, number>; loop?: boolean; paused?: boolean; muted?: boolean; onSceneChange?: (k: string) => void;
} = {}) {
  const { currentSceneKey } = useVideoPlayer({ durations, loop, paused });
  useEffect(() => { onSceneChange?.(currentSceneKey); }, [currentSceneKey, onSceneChange]);
  const baseSceneKey = currentSceneKey.replace(/_r[12]$/, '');
  const SceneComponent = SCENE_COMPONENTS[baseSceneKey];

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastSceneKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = 0.45;
    if (paused) { audio.pause(); return; }
    if (lastSceneKeyRef.current !== currentSceneKey) {
      lastSceneKeyRef.current = currentSceneKey;
      const t = SCENE_START_SEC[baseSceneKey] ?? 0;
      if (Math.abs(audio.currentTime - t) > AUDIO_SEEK_EPSILON_SEC) audio.currentTime = t;
    }
    audio.play().catch(() => {});
  }, [currentSceneKey, baseSceneKey, muted, paused]);

  return (
    <VideoPausedContext.Provider value={paused}>
      <VideoCanvas aspectRatio={VIDEO_ASPECT_RATIO} style={{ backgroundColor: '#16201e' }}>
        <AnimatePresence mode="sync">
          {SceneComponent && <SceneComponent key={currentSceneKey} />}
        </AnimatePresence>
        <audio ref={audioRef} src={`${import.meta.env.BASE_URL}audio/bg_music.mp3`} preload="auto" autoPlay muted={muted} />
      </VideoCanvas>
    </VideoPausedContext.Provider>
  );
}
