/**
 * A cheap, allocation-free fingerprint of the DISCRETE part of a synced room state.
 *
 * Why: the class and classroom states patch up to 20×/s while players walk, but the UI only
 * cares when a team, a phase, a flag or a timer second changes. The sync modules fold the
 * discrete fields into this fingerprint on every patch and copy the state into a zustand store
 * only when it differs — a moving crowd never re-renders a panel and the patch path allocates
 * nothing. It diffs the WHOLE discrete state, so it does not depend on per-item schema
 * callbacks (the server rewrites arrays with clear() + push(), whose onAdd/onRemove sequence is
 * not something to rely on).
 *
 * Two independent 32-bit lanes (FNV-1a and a djb2 variant) make a missed change practically
 * impossible (a collision needs both lanes to collide on the same patch).
 */
export class Fingerprint {
  a = 0;
  b = 0;

  /** Start a new fingerprint. */
  reset(): this {
    this.a = 0x811c9dc5;
    this.b = 5381;
    return this;
  }

  /** Fold one string (and an end marker, so ["ab","c"] ≠ ["a","bc"]). `undefined` folds as "". */
  str(s: string | undefined): this {
    if (s !== undefined) {
      for (let i = 0; i < s.length; i++) this.unit(s.charCodeAt(i));
    }
    return this.unit(0x1_0000);
  }

  /** Fold one integer field (uint8 / uint16 / int8 …). */
  int(n: number | undefined): this {
    const v = n ?? 0;
    return this.unit(v & 0xffff).unit((v >>> 16) & 0xffff).unit(0x1_0001);
  }

  /** Fold one boolean field. */
  bool(v: boolean | undefined): this {
    return this.unit(v ? 0x1_0002 : 0x1_0003);
  }

  /** True when this fingerprint equals the remembered pair. */
  same(a: number, b: number): boolean {
    return this.a === a && this.b === b;
  }

  private unit(c: number): this {
    this.a = Math.imul(this.a ^ c, 0x01000193);
    this.b = (Math.imul(this.b, 33) ^ c) | 0;
    return this;
  }
}
