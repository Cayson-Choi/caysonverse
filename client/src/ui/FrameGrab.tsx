import { useEffect } from "react";
import { addAfterEffect, useThree } from "@react-three/fiber";
import { useAppStore } from "../stores/appStore";
import { reconnectFrame } from "./reconnectFrame";

/**
 * Inside the Canvas: while a reconnect is running, keep one picture of the village taken right after a rendered frame (the only
 * moment a WebGL canvas can be copied without preserveDrawingBuffer), for the reconnect overlay to show over the remounting scene.
 */
export function FrameGrab() {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    const unsubStore = useAppStore.subscribe((s, prev) => {
      // not while resuming: that scene is the new, still-black one (a second drop mid-resume keeps the first picture)
      if (s.reconnecting && !prev.reconnecting && !s.resuming) reconnectFrame.want();
    });
    const unsubFrame = addAfterEffect(() => {
      reconnectFrame.tick();
      if (reconnectFrame.wanted()) reconnectFrame.grab(gl.domElement);
    });
    return () => {
      unsubStore();
      unsubFrame();
    };
  }, [gl]);
  return null;
}
