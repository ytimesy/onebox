"""Independent D4 geometry hash oracle for development fixtures on stdin."""
import hashlib
import json
import sys
from reference_solver import validate


def encode(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False)


def shape_key(shape):
    candidates = []
    # Compute each orientation directly, without TS or reference rotate helpers.
    for r in range(4):
        rotated = [((x,y),(-y,x),(-x,-y),(y,-x))[r] for x,y in shape]
        bx = min(x for x,y in rotated)
        by = min(y for x,y in rotated)
        candidates.append(encode(sorted((x-bx,y-by) for x,y in rotated)))
    return min(candidates)


def geometry_key(puzzle):
    validate(puzzle)
    variants = []
    for mirror in (False, True):
        for r in range(4):
            blocked = []
            for x,y in puzzle['board']['blocked']:
                if mirror:
                    x = 4-x
                # Rotate centered board coordinates rather than the TS loop.
                dx,dy = x-2,y-2
                a,b = ((dx,dy),(-dy,dx),(-dx,-dy),(dy,-dx))[r]
                blocked.append((a+2,b+2))
            shapes = []
            for piece in puzzle['pieces']:
                cells = [(-x if mirror else x,y) for x,y in piece['cells']]
                rotated = [((x,y),(-y,x),(-x,-y),(y,-x))[r] for x,y in cells]
                shapes.append(shape_key(rotated))
            variants.append(encode({'blocked':sorted(blocked),'shapes':[json.loads(s) for s in sorted(shapes)]}))
    payload = {'version':'onebox-geometry-v1','geometry':json.loads(min(variants))}
    return hashlib.sha256(encode(payload).encode()).hexdigest()


if __name__ == '__main__':
    print(json.dumps([geometry_key(p) for p in json.load(sys.stdin)], separators=(',', ':')))
