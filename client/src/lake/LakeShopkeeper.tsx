import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useAnimations } from "@react-three/drei";
import { LoopOnce, Vector3, type AnimationAction, type Group, type Material, type Object3D } from "three";
import { LAKE_SHOPKEEPER_FLOOR_LIFT, LAKE_SHOPKEEPER_NODE } from "@caysonverse/shared/village/npcLooks";
import type { Pose } from "../game/types";
import { reportAvatarClip } from "../game/useAvatar";
import { useNpcAvatar } from "../village/npcAvatar";
import { forEachAngler } from "./lakeNet";
import { onRentalPad } from "./lakeNearby";
import { emptyShopCue, stepShopCue } from "./shopkeeperCue";
import { dayNight } from "../village/dayNightDriver";

const PROBE = "npc:lake_shopkeeper";
/**
 * The shop's fluorescent light on the shopkeeper. The interior is drawn with baked light, the same by day and night, while the
 * shopkeeper is lit live: at night the scene's light drops and he went dark (blue) inside a bright shop, on every tier. His own
 * materials get the shop's light as a glow of their own colour (diffuse x SHOP_GLOW, added to the emissive term), as strong as
 * the night is (nothing by day) — no extra scene light, so nothing else pays for it.
 */
const SHOP_GLOW = 0.6;

/** Adds `diffuse x shopGlow` to a standard material's emissive light (its own copy: the avatar's materials are its own). */
function addShopGlow(m: Material, glow: { value: number }): void {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.shopGlow = glow;
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", "uniform float shopGlow;\nvoid main() {")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += diffuseColor.rgb * shopGlow;");
  };
  m.customProgramCacheKey = () => "npc-shop-glow";
  m.needsUpdate = true;
}

/** How often (s) the anglers are looked over for a rented / returned rod. */
const SCAN_S = 0.4;

/**
 * 낚시터 대여점 주인(owner 2026-11-16 "낚시대 대여점에도 안에 낚시대 관리하는 캐릭터가 있는게 좋을거 같아"): 관리소 창구 안, lake_structures.glb의
 * `npc__lake_shopkeeper` 노드 자리에 서서 남쪽(대여 발판)을 본다. 창구 턱에 손을 얹고 내다보며 정리하다가(Npc_Shop_Idle), 누가 대를 빌리거나
 * 돌려주면, 또는 내가 대여 발판에 올라서면 손을 흔든다(Npc_Shop_Wave). 플레이어는 이 모습을 고를 수 없다(npcLooks.ts).
 */
export function LakeShopkeeper({ structures, pose }: { structures: Object3D; pose: Pose }) {
  const { avatar, clips, look } = useNpcAvatar("lake_shopkeeper", PROBE);
  const groupRef = useRef<Group>(null);
  const { actions, mixer } = useAnimations(clips, groupRef);

  const place = useMemo(() => {
    const node = structures.getObjectByName(LAKE_SHOPKEEPER_NODE);
    const at = new Vector3(102, 0.4, -20.9);
    if (node) {
      structures.updateWorldMatrix(true, true);
      node.getWorldPosition(at);
    }
    at.y += LAKE_SHOPKEEPER_FLOOR_LIFT; // on the shop's floor tiles, behind the counter (top 1.42)
    return at;
  }, [structures]);

  const wave = useRef<() => void>(() => {});
  useEffect(() => {
    const base = actions[look.idle];
    base?.reset().play();
    if (import.meta.env.DEV && base) queueMicrotask(() => reportAvatarClip(PROBE, base.getClip().name));
    const hello: AnimationAction | null = look.greet ? (actions[look.greet] ?? null) : null;
    if (!base || !hello) return;
    hello.setLoop(LoopOnce, 1);
    hello.clampWhenFinished = false;
    const onFinished = (e: { action: AnimationAction }) => {
      if (e.action !== hello) return;
      base.reset().fadeIn(0.35).play();
      hello.fadeOut(0.35);
      if (import.meta.env.DEV) reportAvatarClip(PROBE, base.getClip().name);
    };
    mixer.addEventListener("finished", onFinished as never);
    wave.current = () => {
      if (hello.isRunning()) return;
      hello.reset().fadeIn(0.3).play();
      base.fadeOut(0.3);
      if (import.meta.env.DEV) reportAvatarClip(PROBE, hello.getClip().name);
    };
    return () => {
      wave.current = () => {};
      mixer.removeEventListener("finished", onFinished as never);
    };
  }, [actions, mixer, look]);

  const glow = useMemo(() => ({ value: 0 }), []);
  useEffect(() => {
    for (const m of avatar.materials) addShopGlow(m, glow);
  }, [avatar, glow]);
  const cue = useRef(emptyShopCue());
  const scanT = useRef(0);
  useFrame((_, delta) => {
    glow.value = SHOP_GLOW * dayNight.applied.lights;
    scanT.current += delta;
    if (scanT.current < SCAN_S) return;
    scanT.current = 0;
    const holders = new Set<string>();
    forEachAngler((sid) => holders.add(sid));
    if (stepShopCue(cue.current, holders, onRentalPad(pose.x, pose.z), performance.now())) wave.current();
  });

  return (
    <group ref={groupRef} position={place}>
      <primitive object={avatar.root} />
    </group>
  );
}
