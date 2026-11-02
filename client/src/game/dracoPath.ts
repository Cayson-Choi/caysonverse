import { useGLTF } from "@react-three/drei";
import { DRACO_PATH } from "./hub/hubModelPrep";

/**
 * Where drei's shared Draco loader finds its decoder (AI 학교 탈출, Task 23: the copy in client/public/draco/). drei keeps ONE
 * DRACOLoader and resets its path on every load that does not name one (`useGLTF(url)` -> Google's CDN), so a Draco model
 * loaded after any such call (the character model's) would come from the CDN. Setting the default once, here, at start-up
 * (main.tsx imports this before anything loads), keeps every Draco load on our own server. Loads nothing by itself.
 */
useGLTF.setDecoderPath(DRACO_PATH);
