#!/usr/bin/env python3
"""ONEBOX reference verifier, not the production application.
Python 3.10+; standard library only. Count exact-cover solutions, stopping at 2.
Usage: python3 verification/reference_solver.py examples/sample_puzzle.json
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path
from typing import Iterable

Cell = tuple[int, int]
Shape = tuple[Cell, ...]

def normalize(cells: Iterable[Cell]) -> Shape:
    cells = tuple(cells)
    if not cells:
        raise ValueError('Empty shape')
    min_x = min(x for x, _ in cells)
    min_y = min(y for _, y in cells)
    return tuple(sorted((x - min_x, y - min_y) for x, y in cells))

def rotate(shape: Shape, quarter_turns: int) -> Shape:
    for _ in range(quarter_turns % 4):
        shape = normalize((-y, x) for x, y in shape)
    return normalize(shape)

def orientations(shape: Shape) -> list[tuple[int, Shape]]:
    seen: set[Shape] = set()
    result: list[tuple[int, Shape]] = []
    for r in range(4):
        s = rotate(shape, r)
        if s not in seen:
            result.append((r, s))
            seen.add(s)
    return result

def connected(cells: Iterable[Cell]) -> bool:
    remaining = set(cells)
    if not remaining:
        return False
    stack = [remaining.pop()]
    while stack:
        x, y = stack.pop()
        for n in ((x-1,y), (x+1,y), (x,y-1), (x,y+1)):
            if n in remaining:
                remaining.remove(n)
                stack.append(n)
    return not remaining

def free_signature(shape: Shape) -> Shape:
    reflected = normalize((-x, y) for x, y in shape)
    return min([s for _, s in orientations(shape)] +
               [s for _, s in orientations(reflected)])

def validate(puzzle: dict) -> None:
    board = puzzle['board']
    if (board['width'], board['height']) != (5, 5):
        raise ValueError('v1 requires a 5x5 board')
    blocked = [tuple(c) for c in board['blocked']]
    if len(blocked) != 5 or len(set(blocked)) != 5:
        raise ValueError('Exactly five distinct blocked cells required')
    if any(type(x) is not int or type(y) is not int or
           not (0 <= x < 5 and 0 <= y < 5) for x, y in blocked):
        raise ValueError('Invalid blocked coordinate')
    open_cells = {(x,y) for x in range(5) for y in range(5)} - set(blocked)
    if not connected(open_cells):
        raise ValueError('Open board must be connected')
    pieces = puzzle['pieces']
    if len(pieces) != 4 or len({p['id'] for p in pieces}) != 4:
        raise ValueError('Four distinct piece IDs required')
    signatures = set()
    for p in pieces:
        raw = tuple(tuple(c) for c in p['cells'])
        if (len(raw) != 5 or len(set(raw)) != 5 or
                any(type(x) is not int or type(y) is not int for x,y in raw)):
            raise ValueError('Each piece needs five distinct integer cells')
        if normalize(raw) != tuple(sorted(raw)) or not connected(raw):
            raise ValueError('Piece must be normalized and connected')
        key = free_signature(raw)
        if key in signatures:
            raise ValueError('v1 uses four shapes distinct even under reflection')
        signatures.add(key)
    if puzzle.get('rules', {}).get('allow_reflection', False):
        raise ValueError('Reflection is not allowed')

def count_solutions(puzzle: dict, limit: int = 2, node_limit: int = 1_000_000) -> dict:
    """Returns capped count and proof status. Timeout is NEVER uniqueness."""
    if limit < 2:
        raise ValueError('Use a limit of at least 2 to test uniqueness')
    validate(puzzle)
    blocked = {tuple(c) for c in puzzle['board']['blocked']}
    open_cells = sorted({(x,y) for x in range(5) for y in range(5)} - blocked)
    col_index = {c:i for i,c in enumerate(open_cells)}
    piece_offset = len(open_cells)
    rows: list[tuple[int, dict]] = []
    for pi, p in enumerate(puzzle['pieces']):
        shape = tuple(tuple(c) for c in p['cells'])
        for rotation, cells in orientations(shape):
            max_x, max_y = max(x for x,y in cells), max(y for x,y in cells)
            for y in range(5-max_y):
                for x in range(5-max_x):
                    occupied = {(x+dx,y+dy) for dx,dy in cells}
                    if occupied <= col_index.keys():
                        mask = 1 << (piece_offset + pi)
                        for c in occupied:
                            mask |= 1 << col_index[c]
                        rows.append((mask, {'piece_id':p['id'], 'rotation':rotation,
                                            'x':x, 'y':y}))
    ncols = piece_offset + len(puzzle['pieces'])
    col_rows = [[i for i,(mask,_) in enumerate(rows) if mask & (1<<c)]
                for c in range(ncols)]
    solutions: list[list[dict]] = []
    nodes = 0
    aborted = False
    limit_reached = False
    def dfs(remaining: int, chosen: list[int]) -> None:
        nonlocal nodes, aborted, limit_reached
        if aborted or len(solutions) >= limit:
            if len(solutions) >= limit:
                limit_reached = True
            return
        nodes += 1
        if nodes > node_limit:
            aborted = True
            return
        if remaining == 0:
            solutions.append([rows[i][1] for i in chosen])
            return
        best = None
        bits = remaining
        while bits:
            bit = bits & -bits
            c = bit.bit_length()-1
            candidates = [i for i in col_rows[c] if rows[i][0] & remaining == rows[i][0]]
            if not candidates:
                return
            if best is None or len(candidates) < len(best):
                best = candidates
                if len(best) == 1:
                    break
            bits ^= bit
        for i in best or []:
            dfs(remaining ^ rows[i][0], chosen + [i])
            if aborted or len(solutions) >= limit:
                if len(solutions) >= limit:
                    limit_reached = True
                return
    dfs((1 << ncols)-1, [])
    return {'solution_count_capped':len(solutions), 'count_limit':limit,
            'exhaustive':not aborted and not limit_reached, 'aborted':aborted,
            'unique_proven':len(solutions)==1 and not aborted and not limit_reached,
            'nodes':nodes, 'legal_placements':len(rows), 'solutions':solutions}

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('puzzle', type=Path)
    parser.add_argument('--node-limit', type=int, default=1_000_000)
    args = parser.parse_args()
    try:
        puzzle = json.loads(args.puzzle.read_text(encoding='utf-8'))
        report = count_solutions(puzzle, node_limit=args.node_limit)
    except (OSError, ValueError, KeyError, TypeError) as exc:
        parser.exit(2, f'Invalid input: {exc}\n')
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if not report['unique_proven']:
        raise SystemExit(1)

if __name__ == '__main__':
    main()
