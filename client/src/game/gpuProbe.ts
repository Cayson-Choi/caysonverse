/**
 * Is WebGL drawn by the CPU here (perf/interaction-latency)? A software rasteriser (SwiftShader, llvmpipe, Microsoft
 * Basic Render Driver: a PC whose graphics driver Chrome has blocked, a VM, a remote desktop) draws the rich tier at
 * 0.5 fps and even the light tier at under 2 fps on a 2560-wide screen; every click then waits seconds for its frame.
 * "자동" therefore picks the light tier there (quality.ts `resolveQuality`). An explicit "화려하게" is still honoured.
 *
 * Asked once per session, with a throwaway context that is let go at once (making one costs ~80 ms of waiting on the
 * GPU process: `prewarmSoftwareGlProbe` asks in idle time on the entry screen, before the scene needs the answer).
 */

const SOFTWARE = /swiftshader|llvmpipe|softpipe|software ?(rasterizer|renderer|adapter)|microsoft basic render/i;

/** Pure: does this WebGL renderer string name a software rasteriser? */
export function isSoftwareRenderer(renderer: string | null | undefined): boolean {
  return !!renderer && SOFTWARE.test(renderer);
}

interface ProbeGl {
  RENDERER: number;
  getParameter(p: number): unknown;
  getExtension(name: string): unknown;
}

/** The renderer string of a context: the unmasked one where the plain one is only the browser's generic name. */
export function rendererOf(gl: ProbeGl): string {
  const plain = String(gl.getParameter(gl.RENDERER) ?? "");
  if (plain && !/^(webkit webgl|mozilla|webgl)$/i.test(plain.trim())) return plain;
  const ext = gl.getExtension("WEBGL_debug_renderer_info") as { UNMASKED_RENDERER_WEBGL: number } | null;
  const unmasked = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? "") : "";
  return unmasked || plain;
}

let cached: boolean | null = null;

/** Whether this browser draws WebGL in software (false when it cannot tell, or outside a browser). */
export function softwareGl(): boolean {
  if (cached !== null) return cached;
  cached = false;
  if (typeof document === "undefined") return cached;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const gl = (canvas.getContext("webgl2") ?? canvas.getContext("webgl")) as (ProbeGl & WebGLRenderingContext) | null;
    if (gl) {
      cached = isSoftwareRenderer(rendererOf(gl));
      (gl.getExtension("WEBGL_lose_context") as { loseContext(): void } | null)?.loseContext();
    }
  } catch {
    cached = false;
  }
  return cached;
}

/** Ask `softwareGl()` in idle time (the entry screen), so the scene's first render finds the answer ready. */
export function prewarmSoftwareGlProbe(): void {
  if (typeof window === "undefined") return;
  const ask = () => void softwareGl();
  if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(ask, { timeout: 3000 });
  else setTimeout(ask, 500);
}
