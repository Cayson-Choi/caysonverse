/**
 * Settings → systems that are not React (controls-ux final fix).
 *
 * WorldScene used to subscribe to the WHOLE settings object just to forward the name tag
 * mode, so every look-sensitivity slider step re-rendered WorldScene, the Canvas and all
 * 100 RemotePlayers. The mode only matters to the NametagSystem (it reads the registry at
 * its 5 Hz pass), so it is forwarded from a plain store subscription: nothing renders, and
 * only an actual change of `nametagMode` does any work. The other settings are read where
 * they are used (CameraRig at event time, the touch HUD through its own narrow selectors).
 */

import { useSettingsStore } from "../stores/settingsStore";
import { setNametagMode } from "./labelRegistry";

/** Apply the saved name tag mode now and follow its changes; returns the disposer. */
export function bindNametagMode(): () => void {
  setNametagMode(useSettingsStore.getState().settings.nametagMode);
  return useSettingsStore.subscribe((state, prev) => {
    if (state.settings.nametagMode !== prev.settings.nametagMode) {
      setNametagMode(state.settings.nametagMode);
    }
  });
}
