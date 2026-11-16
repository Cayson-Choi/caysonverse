#!/bin/bash
# usage: bake_all.sh N [size] [samples]  -> day + night light maps, GLB, WebP, copies to client/public/models/village/houses
N=$1; SIZE=${2:-2048}; SM=${3:-384}
B="/c/Program Files/Blender Foundation/Blender 5.3/blender.exe"
cd "$(dirname "$0")/../../../.." || exit 1
"$B" -b art/village/work/house_${N}_authoring.blend -P art/village/tools/houses/bake_house.py -- --house $N --size $SIZE --samples $SM 2>&1 | grep -E "bake_house|Error|Traceback|rror" 
"$B" -b art/village/work/house_${N}_lmprep.blend -P art/village/tools/houses/bake_house.py -- --house $N --night --size $SIZE --samples $SM 2>&1 | grep -E "bake_house|Error|Traceback|rror"
python art/village/tools/houses/post_house.py --house $N --client
echo BAKEDONE
