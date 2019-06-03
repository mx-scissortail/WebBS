#!/bin/sh
TYPES="$(awk -v ORS=', ' '/export const \w+/ {print $3}' ./compiler/syntax.js)"
TYPES=${TYPES%??}
find ./compiler/ -type f -name "*.js" | xargs sed -i "s/\/\* ALL_ASTYPES \*\/.*\/\* END_ALL_ASTYPES \*\//\/\* ALL_ASTYPES \*\/ ${TYPES} \/\* END_ALL_ASTYPES \*\//"
find ./editor/ -type f -name "*.js" | xargs sed -i "s/\/\* ALL_ASTYPES \*\/.*\/\* END_ALL_ASTYPES \*\//\/\* ALL_ASTYPES \*\/ ${TYPES} \/\* END_ALL_ASTYPES \*\//"