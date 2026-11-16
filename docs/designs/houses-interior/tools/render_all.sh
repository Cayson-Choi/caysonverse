#!/bin/bash
# usage: render_all.sh N [res] [samples]   -> day + night renders of house N from its authoring blend (sequential, shared GPU)
N=$1; RES=${2:-960}; SM=${3:-32}
B="/c/Program Files/Blender Foundation/Blender 5.3/blender.exe"
cd "$(dirname "$0")/../../../.." || exit 1
"$B" -b art/village/work/house_${N}_authoring.blend -P art/village/tools/houses/render_house.py -- --house $N --res $RES --samples $SM 2>&1 | grep -E "RENDERED|Error|Traceback" 
"$B" -b art/village/work/house_${N}_authoring.blend -P art/village/tools/houses/render_house.py -- --house $N --night --res $RES --samples $SM 2>&1 | grep -E "RENDERED|Error|Traceback"
echo DONE
