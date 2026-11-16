import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useAnimations } from "@react-three/drei";
import { Quaternion, Vector3, type Group, type Object3D } from "three";
import { BUS_DRIVER } from "@caysonverse/shared/village/npcLooks";
import { getTransitRenderPose } from "../net/transitSync";
import { reportAvatarClip } from "../game/useAvatar";
import { useNpcAvatar } from "./npcAvatar";
import { steerWeights, stepYawRate } from "./busDriverSteer";

const PROBE = "npc:bus_driver";
const Z = new Vector3(0, 0, 1);

/** A node's position in the bus model's frame. */
function localPos(busRoot: Object3D, node: Object3D): Vector3 {
  busRoot.updateWorldMatrix(true, true);
  return busRoot.worldToLocal(node.getWorldPosition(new Vector3()));
}

/**
 * 버스 기사(owner 2026-11-16: "버스기사캐릭터가 앉아서 핸들을 조정하고 있으면 좋겠고"). 마을버스 모형의 자식으로 운전석에 앉아 두 손으로
 * 운전대를 잡는다(npcLooks.ts BUS_DRIVER: v3의 `bus_driver_sit` 자리, 없으면 옛 운전대 중심에서 같은 상대 위치). Npc_Drive(잔잔한 조향·
 * 거울 보기)를 늘 돌리고, 버스가 도는 빠르기(서버 경로 자세의 yaw 변화)만큼 Npc_Drive_Left/Right를 무게로 섞는다. v3 모형의
 * `bus_steering_wheel`은 같은 만큼 기둥 축(로컬 Z) 둘레로 돌린다. 플레이어는 이 모습을 고를 수 없다.
 */
export function BusDriver({ busRoot }: { busRoot: Object3D }) {
  const { avatar, clips } = useNpcAvatar("bus_driver", PROBE);
  const groupRef = useRef<Group>(null);
  const { actions } = useAnimations(clips, groupRef);

  const place = useMemo(() => {
    const sit = busRoot.getObjectByName(BUS_DRIVER.sitNode);
    if (sit) return localPos(busRoot, sit).add(new Vector3(0, BUS_DRIVER.rootLift, 0));
    const wheel = busRoot.getObjectByName(BUS_DRIVER.wheelNode);
    const hub = wheel ? localPos(busRoot, wheel) : new Vector3(...BUS_DRIVER.wheelHubV2);
    return hub.add(new Vector3(...BUS_DRIVER.rootFromHub));
  }, [busRoot]);

  // the wheel the driver turns (v3: its own node, turned about its column = local Z); its rest rotation is kept to turn from
  const wheel = useMemo(() => {
    const node = busRoot.getObjectByName(BUS_DRIVER.wheelNode);
    return node ? { node, rest: node.quaternion.clone() } : null;
  }, [busRoot]);
  useEffect(
    () => () => {
      if (!wheel) return;
      wheel.node.quaternion.copy(wheel.rest);
      wheel.node.updateMatrix();
    },
    [wheel],
  );

  useEffect(() => {
    const drive = actions.Npc_Drive;
    const left = actions.Npc_Drive_Left;
    const right = actions.Npc_Drive_Right;
    for (const a of [drive, left, right]) a?.reset().play();
    left?.setEffectiveWeight(0);
    right?.setEffectiveWeight(0);
    if (import.meta.env.DEV && drive) queueMicrotask(() => reportAvatarClip(PROBE, drive.getClip().name));
  }, [actions]);

  const steer = useRef({ yaw: Number.NaN, rate: 0, s: 0 });
  const turn = useMemo(() => new Quaternion(), []);
  useFrame((_, delta) => {
    const pose = getTransitRenderPose();
    const st = steer.current;
    stepYawRate(st, pose.yaw, delta);
    const w = steerWeights(st.s);
    actions.Npc_Drive?.setEffectiveWeight(w.drive);
    actions.Npc_Drive_Left?.setEffectiveWeight(w.left);
    actions.Npc_Drive_Right?.setEffectiveWeight(w.right);
    if (wheel) {
      turn.setFromAxisAngle(Z, (w.left - w.right) * BUS_DRIVER.fullWheelTurn);
      wheel.node.quaternion.copy(wheel.rest).multiply(turn);
      wheel.node.updateMatrix();
      wheel.node.updateMatrixWorld(true);
    }
  });

  return (
    <group ref={groupRef} position={place} rotation-y={BUS_DRIVER.yaw}>
      <primitive object={avatar.root} />
    </group>
  );
}
