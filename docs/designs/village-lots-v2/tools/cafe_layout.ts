/**
 * The café rooms' layout for the Blender kit (parts_lot_cafe_room.py / parts_lot_cafe_upstairs.py `--layout`): the café's lot (its units and
 * door) and every walk-in interior spec, as JSON.  npx tsx docs/designs/village-lots-v2/tools/cafe_layout.ts > cafe_layout.json
 */
import { CAFE_LOT, LOT_INTERIORS } from "../../../../shared/src/village/villageLots";

process.stdout.write(JSON.stringify({ lots: [CAFE_LOT], interiors: LOT_INTERIORS }, null, 1));
