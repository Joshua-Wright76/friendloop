#!/usr/bin/env bash
# Clean re-record of every take across 7 shards, retrying only takes that failed.
cd "$(dirname "$0")"; R="$PWD"
ALL=$(cd "$R" && grep -hoE '^\s+[A-Z][0-9]+: \{' flows/*.mjs journeys/*.mjs | grep -oE '[A-Z][0-9]+' | sort -u)
SHARDS=7; i=0; declare -a L
for id in $ALL; do k=$((i % SHARDS)); L[$k]="${L[$k]:+${L[$k]},}$id"; i=$((i+1)); done
rm -rf output/flows output/journeys; mkdir -p logs
for k in $(seq 0 $((SHARDS-1))); do ( ./rec.sh --shard $k --only "${L[$k]}" > logs/shard-$k.log 2>&1 ) & done; wait
for round in 1 2; do
  for k in $(seq 0 $((SHARDS-1))); do ( ./rec.sh --shard $k --only "${L[$k]}" --skip-existing > logs/retry$round-$k.log 2>&1 ) & done; wait
done
grep -h '^FAIL' logs/retry2-*.log; echo finished; 
