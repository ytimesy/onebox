# Reference-only fixture builder, not a publishing pipeline.
import importlib.util, random, json, time, sys
from datetime import datetime, timezone
from pathlib import Path
root=Path(__file__).resolve().parents[1]
(root/'examples').mkdir(exist_ok=True)
(root/'verification').mkdir(exist_ok=True)
spec=importlib.util.spec_from_file_location('solver',root/'verification/reference_solver.py')
m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
shapes={((0,0),)}
for size in range(2,6):
    nxt=set()
    for s in shapes:
        for x,y in s:
            for c in ((x-1,y),(x+1,y),(x,y-1),(x,y+1)):
                if c not in s:
                    n=m.normalize((*s,c))
                    nxt.add(min(t for _,t in m.orientations(n)))
    shapes=nxt
shapes=sorted(shapes)
placements={}
for s in shapes:
    entries=[]
    for r, cells in m.orientations(s):
        for y in range(5-max(c[1] for c in cells)):
            for x in range(5-max(c[0] for c in cells)):
                occ={(x+dx,y+dy) for dx,dy in cells}
                entries.append((r,x,y,occ))
    placements[s]=entries
rng=random.Random(20261012)
accepted=[]; reject_non_unique=0; inspected=0
seen=set(); start=time.perf_counter()
while len(accepted)<30 and inspected<20000:
    inspected+=1
    chosen=rng.sample(shapes,4)
    if len({m.free_signature(s) for s in chosen})!=4: continue
    used=set(); actual=[]
    for s in chosen:
        options=[q for q in placements[s] if not q[3]&used]
        if not options: break
        q=rng.choice(options); actual.append(q); used|=q[3]
    if len(actual)!=4 or not m.connected(used): continue
    blocked=set((x,y) for x in range(5) for y in range(5))-used
    # Reject isolated one-cell necks with no need to complicate fixture rules.
    p={'schema_version':1,'rules_version':'onebox-v1','puzzle_id':f'fixture-{len(accepted)+1:03d}',
       'purpose':'design_verification_only','board':{'width':5,'height':5,'blocked':sorted(blocked)},
       'pieces':[{'id':chr(65+i),'cells':s,'initial_rotation':0,'pattern_id':['dots','stripes','grid','rings'][i]} for i,s in enumerate(chosen)],
       'rules':{'allow_reflection':False,'target_seconds':60,'allow_overtime':True}}
    r=m.count_solutions(p)
    if not r['unique_proven']:
        reject_non_unique+=1;continue
    key=(tuple(sorted(blocked)),tuple(sorted(chosen)))
    if key in seen:continue
    seen.add(key)
    accepted.append((p,r))
if len(accepted) != 30:
    raise RuntimeError('Failed to generate 30 fixtures within the candidate budget')
# Pick a representative nontrivial search fixture. Solver nodes are NOT human difficulty.
accepted.sort(key=lambda x:x[1]['nodes'],reverse=True)
for i, (item, _) in enumerate(accepted, 1):
    item['puzzle_id']=f'fixture-{i:03d}'
p,r=accepted[len(accepted)//3]
(root/'examples/sample_puzzle.json').write_text(json.dumps(p,ensure_ascii=False,indent=2)+'\n')
(root/'examples/sample_solution.PRIVATE.json').write_text(json.dumps({'puzzle_id':p['puzzle_id'],'placements':r['solutions'][0]},indent=2)+'\n')
(root/'examples/verified_fixture_batch.json').write_text(json.dumps([{'puzzle':p,'verification':{k:v for k,v in r.items() if k!='solutions'}} for p,r in accepted],ensure_ascii=False,indent=2)+'\n')
report={'test_date':datetime.now(timezone.utc).date().isoformat(),'environment':'assistant container; not user Mac mini',
        'method':'deterministic seeded candidate generation + exact-cover reference solver (cap 2)',
        'accepted_count':len(accepted),'candidate_draws':inspected,'rejected_non_unique_after_geometry_filter':reject_non_unique,
        'elapsed_seconds':round(time.perf_counter()-start,3),'reference_sample':{k:v for k,v in r.items() if k!='solutions'},
        'limitations':['Not a UI/playability test','No human difficulty or 60-second completion evidence',
                      'Not a production content pipeline','Batch dedup is literal only; rotational/reflection dedup still required in production',
                      'No cloud deployment or load test performed']}
(root/'verification/generation_report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report,ensure_ascii=False,indent=2))
print('BOARD / ANSWER:')
grid=[['#' if (x,y) in blocked else '.' for x in range(5)]for y in range(5)]
grid=[['#' if [x,y] in [list(c) for c in p['board']['blocked']] else '.' for x in range(5)]for y in range(5)]
for row in grid:print(' '.join(row))
for place in r['solutions'][0]:
    piece=next(q for q in p['pieces'] if q['id']==place['piece_id'])
    for dx,dy in m.rotate(tuple(map(tuple,piece['cells'])),place['rotation']):
        grid[place['y']+dy][place['x']+dx]=place['piece_id']
print('answer')
for row in grid:print(' '.join(row))
print('SHAPES',json.dumps(p['pieces']))
