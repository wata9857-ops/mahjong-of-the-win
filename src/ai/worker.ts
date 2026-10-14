/// <reference lib="webworker" />
// Engine worker: keeps the UI thread free. Sends a fast "instant" result first,
// then the requested deeper analysis (progressive refinement).

import { replay } from '../game/state';
import { analyze } from './decide';
import type { AnalyzeRequest, Analysis } from './types';

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = (e: MessageEvent<AnalyzeRequest>) => {
  const req = e.data;
  try {
    const st = replay(req.match, req.events);
    if (req.mode !== 'instant') {
      const quick: Analysis = analyze(st, { mode: 'instant', objective: req.objective, id: req.id });
      self.postMessage({ ...quick, stage: 'partial' });
    }
    const full = analyze(st, { mode: req.mode, objective: req.objective, id: req.id });
    self.postMessage({ ...full, stage: 'final' });
  } catch (err) {
    self.postMessage({ id: req.id, error: String(err) });
  }
};
