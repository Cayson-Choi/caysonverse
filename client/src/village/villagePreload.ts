import { useGLTF, useTexture } from "@react-three/drei";
import { GLTFLoader } from "three-stdlib";
import { DRACO_PATH } from "../game/hub/hubModelPrep";
import { characterModel } from "../game/characterModel";
import { villageLoad } from "../ui/villageLoad";
import { vegDressing } from "./vegDressing";
import { VILLAGE_LIGHTMAP_URL, VILLAGE_MODEL_URL } from "./villageModelPrep";

/**
 * 첫 입장을 빠르게 (UX 2026-11-16: 입장에 9–60 초, 검은 "불러오는 중…"만 보였다):
 *
 *  - 입장 화면에서 캐릭터를 다 받은 뒤 마을 파일(village.glb와 낮 라이트맵)을 미리 받는다. 닉네임을 적고 옷을 고르는
 *    동안 받아 두므로 입장하기를 누르면 바로 차리기(나무 심기)부터 한다. 같은 drei 캐시(useGLTF / useTexture)에 넣으니
 *    VillageModel이 그대로 읽고, 두 번 받지 않는다.
 *  - village.glb를 받는 진행(바이트)을 입장 로딩 화면(villageLoad)에 알린다: GLTFLoader의 load에 끼어 진행 이벤트를 본다.
 *  - 마을이 다 차려지면(vegDressing) 로딩 화면에 알린다.
 */

let villageModelIn = false;
let patched = false;

/** GLTFLoader.load에 끼어 village.glb의 받은 바이트와 끝을 로딩 화면에 알린다(한 번만). */
function watchVillageDownload(): void {
  if (patched) return;
  patched = true;
  const proto = GLTFLoader.prototype as unknown as {
    load: (url: string, onLoad: (g: unknown) => void, onProgress?: (e: ProgressEvent) => void, onError?: (e: unknown) => void) => void;
  };
  const load = proto.load;
  proto.load = function (this: unknown, url, onLoad, onProgress, onError) {
    if (url !== VILLAGE_MODEL_URL) return load.call(this, url, onLoad, onProgress, onError);
    villageModelIn = false;
    return load.call(
      this,
      url,
      (g) => {
        villageModelIn = true;
        performance.mark?.("cv:village-model-in");
        villageLoad.modelIn();
        onLoad(g);
      },
      (e) => {
        villageLoad.bytes(e.loaded, e.lengthComputable ? e.total : 0);
        onProgress?.(e);
      },
      onError,
    );
  };
}
watchVillageDownload();

vegDressing.subscribe(() => {
  if (!vegDressing.dressed()) return;
  performance.mark?.("cv:dressed");
  villageLoad.dressed();
});

let preloading = false;

/** 마을 파일을 미리 받기 시작한다(이미 받았거나 받는 중이면 아무것도 안 한다). */
export function preloadVillageFiles(): void {
  if (preloading) return;
  preloading = true;
  useGLTF.preload(VILLAGE_MODEL_URL, DRACO_PATH);
  useTexture.preload(VILLAGE_LIGHTMAP_URL);
}

/** 입장 화면: 캐릭터를 다 받은 뒤(미리보기를 늦추지 않게) 마을 파일을 미리 받는다. */
export function preloadVillageAfterCharacter(): void {
  void characterModel.settle().then(() => preloadVillageFiles());
}

/** 입장하기를 눌렀다: 로딩 화면을 열고, 아직이면 마을 파일 받기를 바로 시작한다. */
export function beginVillageEntry(): void {
  villageLoad.begin(performance.now(), {
    charReady: characterModel.state() === "ready",
    modelIn: villageModelIn,
    dressed: false,
  });
  preloadVillageFiles();
}

/** 다시 받아야 할 때(마을 캐시를 비운 뒤): 다음 입장 때 새로 받는다. */
export function forgetVillagePreload(): void {
  preloading = false;
  villageModelIn = false;
}
