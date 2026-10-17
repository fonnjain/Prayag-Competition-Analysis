export interface SceneDetails { title: string; filePath: string; }
const p = (n: number) => `src/components/video/video_scenes/Scene${n}.tsx`;
export const SCENE_DETAILS: Record<string, SceneDetails> = {
  open: { title: 'Every price is a decision', filePath: p(1) },
  rules: { title: 'First match wins', filePath: p(2) },
  pipeline: { title: 'Six checkpoints', filePath: p(3) },
  floor: { title: 'Margin floor', filePath: p(4) },
  trace: { title: 'Excluded, not guessed', filePath: p(5) },
  handoff: { title: 'Human approval', filePath: p(6) },
  calc: { title: 'Calculator arithmetic', filePath: p(7) },
  compare: { title: 'Competitor comparison', filePath: p(8) },
  finale: { title: 'AI role & finale', filePath: p(9) },
};
