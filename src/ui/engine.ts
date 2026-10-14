// Engine client. A new request terminates any running computation so the
// newest game state always wins and the UI never waits on stale work.

import type { Analysis, AnalyzeRequest } from '../ai/types';

type Listener = (a: Analysis) => void;

export class EngineClient {
  private worker: Worker | null = null;
  private busy = false;
  private nextId = 1;
  private latest = 0;
  constructor(private onResult: Listener, private onError: (msg: string) => void) {}

  private spawn(): Worker {
    const w = new Worker(new URL('../ai/worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<Analysis & { error?: string }>) => {
      const a = e.data;
      if (a.id !== this.latest) return;
      if (a.error) { this.busy = false; this.onError('解析中にエラーが発生しました。直前の入力を戻して確認してください。'); return; }
      if (a.stage === 'final') this.busy = false;
      this.onResult(a);
    };
    w.onerror = ev => { this.busy = false; this.onError('解析エンジンでエラーが発生しました。もう一度入力するか、ページを再読み込みしてください。'); };
    return w;
  }

  request(req: Omit<AnalyzeRequest, 'id'>): number {
    if (this.busy && this.worker) { this.worker.terminate(); this.worker = null; }
    if (!this.worker) this.worker = this.spawn();
    const id = this.nextId++;
    this.latest = id;
    this.busy = true;
    // structured clone of plain data
    this.worker.postMessage({ ...req, id } satisfies AnalyzeRequest);
    return id;
  }
}
