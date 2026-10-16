"""Recreate the ignored solution for the public design fixture only."""
import json
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / 'verification'))
from reference_solver import count_solutions

puzzle = json.loads((root / 'examples/sample_puzzle.json').read_text())
result = count_solutions(puzzle)
if not result['unique_proven']:
    raise SystemExit('Design fixture must have one proven solution')
target = root / 'examples/sample_solution.PRIVATE.json'
if not target.exists():
    with target.open('x') as stream:
        json.dump({'puzzle_id': puzzle['puzzle_id'], 'placements': result['solutions'][0]}, stream, indent=2)
        stream.write('\n')
print('Local design-fixture solution ready; no private candidates read or changed.')
