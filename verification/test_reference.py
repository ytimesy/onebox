"""Reference rule checks only; no frontend/backend/real-device verification."""
from __future__ import annotations
import copy
import json
import unittest
from pathlib import Path
from reference_solver import count_solutions, rotate, normalize, validate
ROOT=Path(__file__).resolve().parents[1]
SAMPLE=json.loads((ROOT/'examples/sample_puzzle.json').read_text())
BATCH=json.loads((ROOT/'examples/verified_fixture_batch.json').read_text())

def independent_count(puzzle: dict, cap: int=2) -> int:
    """Independent fixed-piece-order placement DFS, not Algorithm X."""
    open_set={(x,y) for x in range(5) for y in range(5)}-set(map(tuple,puzzle['board']['blocked']))
    options=[]
    for piece in puzzle['pieces']:
        cells=piece['cells']
        variants=set()
        for q in range(4):
            raw=[((x,y),(y,-x),(-x,-y),(-y,x))[q] for x,y in cells]
            bx=min(x for x,y in raw);by=min(y for x,y in raw)
            variants.add(tuple(sorted((x-bx,y-by) for x,y in raw)))
        legal=[]
        for shape in variants:
            for tx in range(5):
                for ty in range(5):
                    loc=frozenset((x+tx,y+ty) for x,y in shape)
                    if loc<=open_set:
                        legal.append(loc)
        options.append(set(legal))
    total=0
    def walk(i:int, used:frozenset)->None:
        nonlocal total
        if total>=cap:return
        if i==4:
            if used==open_set:total+=1
            return
        for loc in options[i]:
            if not used&loc:walk(i+1,used|loc)
    walk(0,frozenset())
    return total

class ReferenceTests(unittest.TestCase):
    def test_all_thirty_with_two_solvers(self):
        self.assertEqual(len(BATCH),30)
        self.assertEqual(len({x['puzzle']['puzzle_id'] for x in BATCH}),30)
        for item in BATCH:
            with self.subTest(puzzle=item['puzzle']['puzzle_id']):
                self.assertTrue(count_solutions(item['puzzle'])['unique_proven'])
                self.assertEqual(independent_count(item['puzzle']),1)
    def test_solution_geometry(self):
        placements=json.loads((ROOT/'examples/sample_solution.PRIVATE.json').read_text())['placements']
        open_set={(x,y) for x in range(5) for y in range(5)}-set(map(tuple,SAMPLE['board']['blocked']))
        used=set()
        for p in placements:
            shape=next(x for x in SAMPLE['pieces'] if x['id']==p['piece_id'])['cells']
            occupied={(p['x']+x,p['y']+y) for x,y in rotate(tuple(map(tuple,shape)),p['rotation'])}
            self.assertFalse(used&occupied)
            self.assertTrue(occupied<=open_set)
            used|=occupied
        self.assertEqual(used,open_set)
    def test_four_rotations_identity(self):
        for p in SAMPLE['pieces']:
            s=tuple(map(tuple,p['cells']))
            self.assertEqual(rotate(s,4),normalize(s))
    def test_reject_duplicate_cells(self):
        p=copy.deepcopy(SAMPLE);p['pieces'][0]['cells'][0]=p['pieces'][0]['cells'][1]
        with self.assertRaises(ValueError):validate(p)
    def test_reject_reflection_rule(self):
        p=copy.deepcopy(SAMPLE);p['rules']['allow_reflection']=True
        with self.assertRaises(ValueError):validate(p)
    def test_reject_bad_board(self):
        p=copy.deepcopy(SAMPLE);p['board']['blocked'][0]=[5,0]
        with self.assertRaises(ValueError):validate(p)
    def test_budget_abort_not_proven(self):
        r=count_solutions(SAMPLE,node_limit=1)
        self.assertTrue(r['aborted']);self.assertFalse(r['unique_proven'])
    def test_none_and_multiple_are_rejected(self):
        for fname,expected in [('negative_unsolvable.json',0),('negative_multiple.json',2)]:
            p=json.loads((ROOT/'examples'/fname).read_text())
            r=count_solutions(p)
            self.assertEqual(r['solution_count_capped'],expected)
            self.assertFalse(r['unique_proven'])
            self.assertEqual(independent_count(p),expected)

if __name__=='__main__':unittest.main(verbosity=2)
