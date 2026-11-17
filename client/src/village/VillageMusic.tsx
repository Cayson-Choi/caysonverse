import { useEffect, useState } from "react";
import { useSoundStore } from "../stores/soundStore";
import { useMusicStore } from "../stores/musicStore";
import { createBrowserBgm, mountVillageBgm, type VillageBgm } from "./villageBgm";
import { useLocalArea } from "./villageArea";
import { isIndoorArea } from "@caysonverse/shared/village/villageLayout";

/**
 * The village's music: owns the controller for as long as the village scene is mounted (the effect creates and
 * disposes it, so a StrictMode double mount leaves one element). It draws nothing: the on/off switch and the volume
 * are the menu's "소리" section (MenuSound.tsx), which reads this through `musicStore`. The controller starts on the
 * first gesture, goes quiet in the memorial hall (`useLocalArea`) and pauses with the tab. The menu's 소리 switch
 * ("소리", soundStore `muted`) silences it as well (final review m4); 배경음악 is the music's own choice.
 */
export function VillageMusic() {
  const area = useLocalArea();
  const [bgm, setBgm] = useState<VillageBgm | null>(null);
  const muted = useSoundStore((s) => s.muted);
  const volume = useMusicStore((s) => s.volume);

  useEffect(
    () =>
      mountVillageBgm({
        create: createBrowserBgm,
        doc: document,
        setBgm,
        setOn: (on) => useMusicStore.getState().setOn(on),
        probe: import.meta.env.DEV ? window : null,
      }),
    [],
  );

  useEffect(() => {
    useMusicStore.getState().setAvailable(bgm !== null);
    return () => useMusicStore.getState().setAvailable(false);
  }, [bgm]);

  useEffect(() => {
    bgm?.setHall(isIndoorArea(area));
  }, [bgm, area]);

  useEffect(() => {
    bgm?.setMuted(muted);
  }, [bgm, muted]);

  useEffect(() => {
    bgm?.setUserVolume(volume);
  }, [bgm, volume]);

  return null;
}
