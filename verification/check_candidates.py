"""Independent machine check, not human difficulty or publication acceptance.

Accept a private TS candidate batch path, or a puzzle array on stdin with '-'.
Print counts/hashes only. Never print seeds, constructions or solutions.
"""
import hashlib
import json
import sys
from pathlib import Path
from reference_solver import count_solutions, rotate
from test_reference import independent_count


def legal_completion(puzzle, placements):
    open_cells = {(x, y) for x in range(5) for y in range(5)} - set(map(tuple, puzzle['board']['blocked']))
    if len(placements) != 4 or {q['piece_id'] for q in placements} != {'A', 'B', 'C', 'D'}:
        return False
    used = set()
    for q in placements:
        shape = next(p['cells'] for p in puzzle['pieces'] if p['id'] == q['piece_id'])
        cells = {(q['x']+x, q['y']+y) for x, y in rotate(tuple(map(tuple, shape)), q['rotation'])}
        if cells & used or not cells <= open_cells:
            return False
        used |= cells
    return used == open_cells


def main():
    if len(sys.argv) != 2:
        raise ValueError('Expected private batch path or stdin marker')
    raw = json.load(sys.stdin) if sys.argv[1] == '-' else json.loads(Path(sys.argv[1]).read_text())
    candidates = raw['candidates'] if isinstance(raw, dict) else [{'puzzle': p} for p in raw]
    reports = []
    for item in candidates:
        puzzle = item['puzzle']
        exact = count_solutions(puzzle)
        dfs = independent_count(puzzle)
        assert not exact['aborted'] and exact['solution_count_capped'] == dfs
        payload_hash = hashlib.sha256(json.dumps(puzzle, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()
        if 'verification' in item:
            assert item['verification']['status'] == 'unique' and exact['unique_proven']
            assert item['verification']['hash'] == payload_hash
            assert legal_completion(puzzle, item['construction'])
            assert legal_completion(puzzle, item['verification']['solution'])
        reports.append({'id': puzzle['puzzle_id'], 'exact_cover_count': exact['solution_count_capped'], 'independent_dfs_count': dfs, 'hash': payload_hash})
    print(json.dumps({'checked': len(reports), 'reports': reports}, separators=(',', ':')))


if __name__ == '__main__':
    main()
