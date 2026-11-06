#!/usr/bin/env bash
# Re-records journeys only, across all shards, retrying failures.
cd "$(dirname "$0")"
rm -rf output/journeys; mkdir -p logs
I=0; declare -a L; for n in 01 02 03 04 05 06 07 08 09 10 11 12; do k=$((I%6)); L[$k]="${L[$k]:+${L[$k]},}W$n"; I=$((I+1)); done
for k in 0 1 2 3 4 5; do ( ./rec.sh --shard $k --kind journeys --only "${L[$k]}" > logs/j-$k.log 2>&1 ) & done; wait
for k in 0 1 2 3 4 5; do ( ./rec.sh --shard $k --kind journeys --only "${L[$k]}" --skip-existing > logs/jr-$k.log 2>&1 ) & done; wait
grep -h '^FAIL' logs/jr-*.log; grep -h 'passed$' logs/j-*.log; echo finished
