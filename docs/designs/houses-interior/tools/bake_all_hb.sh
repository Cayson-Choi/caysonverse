#!/bin/bash
# usage: bake_all_hb.sh N [size] [samples] -> HB houses 6-10: day + night light maps, GLB, WebP, copies to client (same as bake_all.sh with bake_house_hb.py)
N=$1; SIZE=${2:-2048}; SM=${3:-384}
B="/c/Program Files/Blender Foundation/Blender 5.3/blender.exe"
cd "$(dirname "$0")/../../../.." || exit 1
"$B" -b -t 4 art/village/work/house_${N}_authoring.blend -P art/village/tools/houses/bake_house_hb.py -- --house $N --size $SIZE --samples $SM $EXTRA 2>&1 | grep -E "bake_house|Error|Traceback|rror"
"$B" -b -t 4 art/village/work/house_${N}_lmprep.blend -P art/village/tools/houses/bake_house_hb.py -- --house $N --night --size $SIZE --samples $SM $EXTRA 2>&1 | grep -E "bake_house|Error|Traceback|rror"
python art/village/tools/houses/post_house.py --house $N --client
echo BAKEDONE
