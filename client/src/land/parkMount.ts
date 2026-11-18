/**
 * Whether 케이슨랜드's tree is mounted (ParkWorld has committed: its assets are in and its geometry is built). The door's curtain
 * (village/DoorFade.tsx) waits for it on the way in, so the park's one heavy first frame is spent behind the black.
 */
let mounted = false;
const listeners = new Set<() => void>();

export const parkMount = {
  isMounted: (): boolean => mounted,
  set(v: boolean): void {
    if (mounted === v) return;
    mounted = v;
    for (const l of [...listeners]) l();
  },
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};
