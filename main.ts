// Push-optimal Sokoban solver (make.fun sokoban-solver-01 entry).
//
// These generated levels are a one-square-wide hallway with rooms off
// it (the competition's RULES.txt describes the generator), and a box
// can never usefully leave its room, so the level decomposes: remove
// the hallway row (the row the player starts on) and the remaining
// floor splits into room components, each holding its own boxes and
// as many goals. Each room is solved on its own with the other rooms'
// boxes held as fixed obstacles, the player free to walk everywhere
// else; the room solutions concatenate, and because walks cost no
// pushes, room-optimal solutions sum to the level's push optimum.
// A level that does not decompose this way (a box on the hallway, a
// room whose box and goal counts differ) falls back to one global
// search over every box.
//
// The room search is over pushes, not steps: a state is (sorted box
// squares, the player's square after the push). For each state the
// player's reachable squares are flood-filled once (parent pointers,
// no string building) and every pushable box generates one successor.
// A* orders states by pushes + heuristic, so the first solution found
// is push-optimal for that room.
//
// Heuristic (admissible for push count): exact minimum-cost matching
// between the room's boxes and goals under Manhattan distance
// (bitmask DP over precomputed distances; rooms hold at most a few
// boxes), or the sum of nearest-goal distances in the global search.
// One push moves one box one square, so neither can overestimate.
//
// Pruning: static dead squares — squares from which no goal is
// reachable by pulls (reverse BFS from the goals over the static
// board) — kill any state with a box on one, unless it is a goal.
//
// Deterministic: budgets are expansion counts, never the clock, and
// heap ties break on insertion order.
// Method references (ideas only; this code is an original
// implementation): push-based A* search, dead-square pruning and
// room decomposition are standard Sokoban techniques, surveyed in the
// Sokoban Solver Statistics pages and the Festival solver's
// documentation; the level structure is make.fun's RULES.txt.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const DX = [0, 0, -1, 1];
const DY = [-1, 1, 0, 0];
const DL = ['u', 'd', 'l', 'r'];

interface Board {
  w: number; h: number; N: number;
  wall: Uint8Array;
  goals: number[]; goalSet: Set<number>;
  boxes: number[]; player: number;
}

function parse(text: string): Board {
  const rows = text.split('\n').filter((r) => r.length > 0);
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const N = w * h;
  const wall = new Uint8Array(N);
  const goals: number[] = [];
  const goalSet = new Set<number>();
  const boxes: number[] = [];
  let player = 0;
  rows.forEach((row, y) => {
    for (let x = 0; x < w; x++) {
      const ch = row[x] ?? '#';
      const i = y * w + x;
      wall[i] = ch === '#' ? 1 : 0;
      if (ch === '.' || ch === '*' || ch === '+') { goals.push(i); goalSet.add(i); }
      if (ch === '$' || ch === '*') boxes.push(i);
      if (ch === '@' || ch === '+') player = i;
    }
  });
  boxes.sort((a, b) => a - b);
  return { w, h, N, wall, goals, goalSet, boxes, player };
}

// Push-A* over `movable` boxes (indices into a sorted start array),
// with `fixed` squares as permanent obstacles, box destinations
// restricted to `destOk`, and the room's own `goals`. Returns the move
// string (uppercase = push) or '' when the budget runs out.
function solveSub(
  bd: Board,
  startBoxes: number[],
  fixed: Set<number>,
  destOk: Uint8Array,
  goals: number[],
  startPlayer: number,
  maxExpansions: number,
): string {
  const { w, h, N, wall } = bd;
  const G = goals.length;
  const goalSet = new Set(goals);
  const boxes0 = [...startBoxes].sort((a, b) => a - b);

  // Manhattan distances per goal, and nearest-goal distance per cell.
  const goalDist: Int32Array[] = goals.map((g) => {
    const gx = g % w, gy = (g / w) | 0;
    const d = new Int32Array(N);
    for (let i = 0; i < N; i++) d[i] = Math.abs((i % w) - gx) + Math.abs(((i / w) | 0) - gy);
    return d;
  });
  const minDist = new Int32Array(N);
  for (let i = 0; i < N; i++) {
    let m = Infinity;
    for (let g = 0; g < G; g++) if (goalDist[g]![i]! < m) m = goalDist[g]![i]!;
    minDist[i] = m;
  }
  const useMatching = boxes0.length <= 8 && G <= 10;
  const heuristic = (bs: number[]): number => {
    if (useMatching) {
      const size = 1 << G;
      let dp = new Float64Array(size).fill(Infinity);
      dp[0] = 0;
      for (let bi = 0; bi < bs.length; bi++) {
        const next = new Float64Array(size).fill(Infinity);
        const b = bs[bi]!;
        for (let mask = 0; mask < size; mask++) {
          const cur = dp[mask]!;
          if (cur === Infinity) continue;
          for (let gi = 0; gi < G; gi++) {
            if (mask & (1 << gi)) continue;
            const nm = mask | (1 << gi);
            const v = cur + goalDist[gi]![b]!;
            if (v < next[nm]!) next[nm] = v;
          }
        }
        dp = next;
      }
      let m = Infinity;
      for (const v of dp) if (v < m) m = v;
      return m;
    }
    let s = 0;
    for (const b of bs) s += minDist[b]!;
    return s;
  };

  // Live squares for these goals, destinations restricted to destOk:
  // reverse pulls; the player's stand square must be a real floor
  // square that is not a fixed obstacle.
  const live = new Uint8Array(N);
  {
    const q: number[] = [];
    for (const g of goals) { live[g] = 1; q.push(g); }
    for (let head = 0; head < q.length; head++) {
      const c = q[head]!;
      const cx = c % w, cy = (c / w) | 0;
      for (let d = 0; d < 4; d++) {
        const bx = cx - DX[d]!, by = cy - DY[d]!;
        const px = cx - 2 * DX[d]!, py = cy - 2 * DY[d]!;
        if (bx < 0 || by < 0 || bx >= w || by >= h || px < 0 || py < 0 || px >= w || py >= h) continue;
        const b = by * w + bx, p = py * w + px;
        if (destOk[b] && !wall[b] && !wall[p] && !fixed.has(p) && !live[b]) { live[b] = 1; q.push(b); }
      }
    }
  }

  // Reusable BFS buffers for player reachability.
  const parent = new Int32Array(N);
  const pdir = new Int8Array(N);
  const stamp = new Int32Array(N);
  let curStamp = 0;
  const blocked = new Uint8Array(N);
  for (const f of fixed) blocked[f] = 1;
  const bfsQ = new Int32Array(N);
  function reachable(p: number, bs: number[]): void {
    curStamp++;
    for (const b of bs) blocked[b] = 1;
    let qh = 0, qt = 0;
    bfsQ[qt++] = p;
    stamp[p] = curStamp;
    parent[p] = -1;
    while (qh < qt) {
      const c = bfsQ[qh++]!;
      const cx = c % w, cy = (c / w) | 0;
      for (let d = 0; d < 4; d++) {
        const nx = cx + DX[d]!, ny = cy + DY[d]!;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (wall[ni] || blocked[ni] || stamp[ni] === curStamp) continue;
        stamp[ni] = curStamp;
        parent[ni] = c;
        pdir[ni] = d;
        bfsQ[qt++] = ni;
      }
    }
    for (const b of bs) blocked[b] = 0;
  }
  function walkTo(target: number, from: number): string {
    let s = '';
    let c = target;
    while (c !== from) {
      s = DL[pdir[c]!]! + s;
      c = parent[c]!;
    }
    return s;
  }

  interface Node { f: number; pushes: number; order: number; boxes: number[]; player: number; moves: string }
  const heap: Node[] = [];
  const less = (a: Node, b: Node): boolean =>
    a.f < b.f || (a.f === b.f && (a.pushes > b.pushes || (a.pushes === b.pushes && a.order < b.order)));
  const hpush = (e: Node): void => {
    let i = heap.length;
    heap.push(e);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!less(heap[i]!, heap[p]!)) break;
      [heap[i], heap[p]] = [heap[p]!, heap[i]!];
      i = p;
    }
  };
  const hpop = (): Node => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      for (let i = 0; ;) {
        let c = 2 * i + 1;
        if (c >= heap.length) break;
        if (c + 1 < heap.length && less(heap[c + 1]!, heap[c]!)) c++;
        if (!less(heap[c]!, heap[i]!)) break;
        [heap[i], heap[c]] = [heap[c]!, heap[i]!];
        i = c;
      }
    }
    return top;
  };
  const keyOf = (bs: number[], p: number): string => String.fromCharCode(p, ...bs);

  let order = 0;
  const best = new Map<string, number>([[keyOf(boxes0, startPlayer), 0]]);
  hpush({ f: heuristic(boxes0), pushes: 0, order: order++, boxes: boxes0, player: startPlayer, moves: '' });
  let expansions = 0;
  while (heap.length > 0 && expansions < maxExpansions) {
    const cur = hpop();
    if (cur.boxes.every((b) => goalSet.has(b))) return cur.moves;
    expansions++;
    reachable(cur.player, cur.boxes);
    for (let bi = 0; bi < cur.boxes.length; bi++) {
      const b = cur.boxes[bi]!;
      const bx = b % w, by = (b / w) | 0;
      for (let d = 0; d < 4; d++) {
        const sx = bx - DX[d]!, sy = by - DY[d]!;
        const tx = bx + DX[d]!, ty = by + DY[d]!;
        if (sx < 0 || sy < 0 || sx >= w || sy >= h || tx < 0 || ty < 0 || tx >= w || ty >= h) continue;
        const stand = sy * w + sx;
        const dest = ty * w + tx;
        if (stamp[stand] !== curStamp || wall[dest] || !destOk[dest] || fixed.has(dest) || cur.boxes.includes(dest)) continue;
        if (!live[dest] && !goalSet.has(dest)) continue; // dead square
        const nb = cur.boxes.slice();
        nb[bi] = dest;
        nb.sort((a, b2) => a - b2);
        const np = cur.pushes + 1;
        const k = keyOf(nb, b);
        const seenAt = best.get(k);
        if (seenAt !== undefined && seenAt <= np) continue;
        best.set(k, np);
        hpush({
          f: np + heuristic(nb),
          pushes: np,
          order: order++,
          boxes: nb,
          player: b,
          moves: cur.moves + walkTo(stand, cur.player) + DL[d]!.toUpperCase(),
        });
      }
    }
  }
  return '';
}

// Replay a move string on the board; returns the end player square
// and box squares. Assumes the moves are legal (our own solutions).
function replay(bd: Board, moves: string): { player: number; boxes: number[] } {
  const boxSet = new Set(bd.boxes);
  let p = bd.player;
  for (const ch of moves) {
    const d = DL.indexOf(ch.toLowerCase());
    if (d < 0) continue;
    const q = p + DY[d]! * bd.w + DX[d]!;
    if (boxSet.has(q)) {
      boxSet.delete(q);
      boxSet.add(q + DY[d]! * bd.w + DX[d]!);
    }
    p = q;
  }
  return { player: p, boxes: [...boxSet].sort((a, b) => a - b) };
}

function solve(text: string): string {
  const bd = parse(text);
  const { w, h, N, wall } = bd;
  const allFloor = new Uint8Array(N);
  for (let i = 0; i < N; i++) allFloor[i] = wall[i] ? 0 : 1;

  // Decompose: drop the hallway row (the player's row) and split the
  // rest of the floor into connected components.
  const hallY = (bd.player / w) | 0;
  const comp = new Int32Array(N).fill(-1);
  const comps: number[][] = [];
  for (let i = 0; i < N; i++) {
    if (wall[i] || ((i / w) | 0) === hallY || comp[i] >= 0) continue;
    const cells: number[] = [];
    const q = [i];
    comp[i] = comps.length;
    for (let head = 0; head < q.length; head++) {
      const c = q[head]!;
      cells.push(c);
      const cx = c % w, cy = (c / w) | 0;
      for (let d = 0; d < 4; d++) {
        const nx = cx + DX[d]!, ny = cy + DY[d]!;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h || ny === hallY) continue;
        const ni = ny * w + nx;
        if (wall[ni] || comp[ni] >= 0) continue;
        comp[ni] = comps.length;
        q.push(ni);
      }
    }
    comps.push(cells);
  }
  const boxOnHall = bd.boxes.some((b) => ((b / w) | 0) === hallY);
  const roomComps = comps
    .map((cells) => {
      const set = new Set(cells);
      return {
        cells,
        boxes: bd.boxes.filter((b) => set.has(b)),
        goals: bd.goals.filter((g) => set.has(g)),
      };
    })
    .filter((c) => c.boxes.length > 0);
  const decomposable = !boxOnHall
    && roomComps.length > 0
    && roomComps.every((c) => c.boxes.length === c.goals.length)
    && roomComps.reduce((s, c) => s + c.boxes.length, 0) === bd.boxes.length;

  if (!decomposable) {
    return solveSub(bd, bd.boxes, new Set(), allFloor, bd.goals, bd.player, 6_000_000);
  }

  // Solve room by room, carrying the real board state along.
  let curBoxes = [...bd.boxes];
  let curPlayer = bd.player;
  let allMoves = '';
  for (const room of roomComps) {
    const fixed = new Set(curBoxes.filter((b) => !room.boxes.includes(b)));
    const destOk = new Uint8Array(N);
    for (const c of room.cells) destOk[c] = 1;
    for (const g of room.goals) destOk[g] = 1;
    const moves = solveSub(bd, room.boxes, fixed, destOk, room.goals, curPlayer, 3_000_000);
    if (moves === '' && !room.boxes.every((b) => room.goals.includes(b))) return '';
    allMoves += moves;
    const state = replay({ ...bd, boxes: curBoxes, player: curPlayer }, moves);
    curBoxes = state.boxes;
    curPlayer = state.player;
  }
  return allMoves;
}

for (const id of readdirSync(I).sort()) {
  const moves = solve(readFileSync(join(I, id, 'level.txt'), 'utf8'));
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'solution.txt'), `${moves}\n`);
}
