/**
 * A stand-in AudioContext for unit tests (the client's tests run in plain node): every node is a recording proxy, so a mix can
 * be built and ticked without a browser. It counts the nodes made, so a test can ask "was anything built?".
 */
export interface FakeStats {
  nodes: number;
  sources: number;
}

function fakeParam(): Record<string, unknown> {
  const p: Record<string, unknown> = {
    value: 0,
    setValueAtTime: (v: number) => {
      p.value = v;
      return p;
    },
    setTargetAtTime: (v: number) => {
      p.value = v;
      return p;
    },
    linearRampToValueAtTime: () => p,
    exponentialRampToValueAtTime: () => p,
    cancelScheduledValues: () => p,
  };
  return p;
}

export function makeFakeContext(state: AudioContextState = "running"): { ctx: BaseAudioContext & AudioContext; stats: FakeStats } {
  const stats: FakeStats = { nodes: 0, sources: 0 };
  const node = (kind: string): unknown => {
    stats.nodes++;
    if (kind === "source") stats.sources++;
    const params: Record<string, Record<string, unknown>> = {};
    const target: Record<string, unknown> = { kind };
    return new Proxy(target, {
      get(t, k: string) {
        if (k in t) return t[k];
        if (k === "connect") return (x: unknown) => x;
        if (k === "disconnect" || k === "start" || k === "stop" || k === "addEventListener") return () => undefined;
        if (k === "then") return undefined;
        if (!params[k]) params[k] = fakeParam();
        return params[k];
      },
      set(t, k: string, v) {
        t[k] = v;
        return true;
      },
    });
  };
  const ctx = {
    state,
    sampleRate: 44100,
    currentTime: 0,
    destination: node("destination"),
    resume: () => Promise.resolve(),
    createGain: () => node("gain"),
    createBiquadFilter: () => node("filter"),
    createOscillator: () => node("osc"),
    createBufferSource: () => node("source"),
    createConstantSource: () => node("constant"),
    createStereoPanner: () => node("panner"),
    createDelay: () => node("delay"),
    createDynamicsCompressor: () => node("compressor"),
    createBuffer: (_c: number, len: number, sr: number) => {
      const data = new Float32Array(len);
      return { length: len, sampleRate: sr, duration: len / sr, getChannelData: () => data };
    },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
  return { ctx: ctx as unknown as BaseAudioContext & AudioContext, stats };
}
