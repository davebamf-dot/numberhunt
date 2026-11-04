// NumberHunt puzzle engine: generation, the one-answer check, and save validation.
// Ported from NumberHunt.pyw. No drawing or browser features in here.
"use strict";

const NH = (() => {
  const MIN_SIZE = 6;
  const MAX_SIZE = 10;
  const LIVES = 3;
  const HINTS = 2;
  const ROW_CAP = 0.49;
  const COLUMN_CAP = 0.56;
  const KEEP_VALUE_MIN = 2;     // kept numbers are 2-9
  const COLUMN_FLOOR_RATIO = 0.8;
  const GENERATION_BUDGET = 1000;   // ms to spend hunting for a puzzle with exactly one answer

  const BLOCK_COLOURS = [
    "#FFA9A6", "#FFCFA3", "#FBE892", "#D9EC9C", "#AEEBC2",
    "#A3E7E0", "#ABDBFC", "#BEC8FC", "#DBC3F9", "#FBC2E2",
  ];

  const DOOM_VARIATIONS = [
    "Are you sure you want to quit? Only losers quit.",
    "Please don't go. The numbers will miss you.",
    "What, going to try the Shareware version now?",
    "Are you really, really sure? Your pride is at risk.",
    "You want to quit now? A true logic master would keep fighting.",
  ];

  const randInt = (low, high) => low + Math.floor(Math.random() * (high - low + 1));
  const choice = (list) => list[Math.floor(Math.random() * list.length)];
  const grid = (size, value) => Array.from({ length: size }, () => Array(size).fill(value));
  const sum = (list) => list.reduce((a, b) => a + b, 0);

  function shuffle(list) {
    for (let i = list.length - 1; i > 0; i--) {
      const j = randInt(0, i);
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  }

  const sample = (list, count) => shuffle(list.slice()).slice(0, count);
  const range = (n) => Array.from({ length: n }, (_, i) => i);

  function generateSolution(size) {
    const maxCellsPerLine = Math.max(2, Math.floor(size * 0.45));
    for (;;) {
      const g = grid(size, false);
      for (let r = 0; r < size; r++) {
        for (const c of sample(range(size), randInt(1, maxCellsPerLine))) g[r][c] = true;
      }
      let singles = 0;
      let valid = true;
      for (let i = 0; i < size; i++) {
        const rowCount = g[i].filter(Boolean).length;
        const colCount = g.filter((line) => line[i]).length;
        for (const count of [rowCount, colCount]) {
          if (count === 1) singles++;
          if (count === 0 || count === size) valid = false;
        }
      }
      if (valid && singles <= 2) return g;
    }
  }

  function generateKeptValues(size, solution) {
    const rowCap = Math.floor(9 * size * ROW_CAP);
    const colCap = Math.floor(9 * size * COLUMN_CAP);
    const colFloor = Math.floor(size * COLUMN_FLOOR_RATIO);
    for (let attempt = 0; attempt < 40; attempt++) {
      const values = solution.map((line) => line.map((kept) => (kept ? randInt(KEEP_VALUE_MIN, 9) : 0)));
      const rowTotals = values.map(sum);
      const colTotals = range(size).map((c) => sum(values.map((line) => line[c])));
      if (Math.max(...rowTotals) <= rowCap && Math.max(...colTotals) <= colCap
          && Math.min(...colTotals) >= colFloor) {
        return { values, rowTotals, colTotals };
      }
    }
    return null;
  }

  function addDecoys(size, solution, values, rowTotals) {
    for (let r = 0; r < size; r++) {
      let decoys = range(size).filter((c) => !solution[r][c]);
      const target = rowTotals[r];
      if (decoys.length >= 2 && target >= 2 && target <= 18 && Math.random() > 0.4) {
        const first = randInt(Math.max(1, target - 9), Math.min(9, target - 1));
        const [a, b] = sample(decoys, 2);
        values[r][a] = first;
        values[r][b] = target - first;
        decoys = decoys.filter((c) => c !== a && c !== b);
      }
      for (const c of decoys) values[r][c] = randInt(1, 9);
    }
  }

  function generateBlocks(size, solution) {
    const targetCount = Math.max(5, Math.round(size * (0.85 + Math.random() * 0.35)));
    const largestAllowed = Math.floor((size * size / targetCount) * 2) + 1;
    const allCells = [];
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) allCells.push([r, c]);

    for (let attempt = 0; attempt < 200; attempt++) {
      const blocks = grid(size, -1);
      const counts = Array(targetCount).fill(1);
      sample(allCells, targetCount).forEach(([r, c], id) => { blocks[r][c] = id; });

      let remaining = size * size - targetCount;
      while (remaining > 0) {
        // Mostly grow the smallest blocks so the sizes stay fairly even
        const order = range(targetCount)
          .map((id) => [counts[id] + Math.random() * 3.5, id])
          .sort((a, b) => a[0] - b[0]);
        for (const [, id] of order) {
          const frontier = [];
          for (let r = 0; r < size; r++) {
            for (let c = 0; c < size; c++) {
              if (blocks[r][c] !== id) continue;
              for (const [nr, nc] of [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]) {
                if (nr >= 0 && nr < size && nc >= 0 && nc < size && blocks[nr][nc] === -1) frontier.push([nr, nc]);
              }
            }
          }
          if (frontier.length) {
            const [nr, nc] = choice(frontier);
            blocks[nr][nc] = id;
            counts[id]++;
            remaining--;
            break;
          }
        }
      }

      if (Math.min(...counts) < 3 || Math.max(...counts) > largestAllowed) continue;

      const kept = Array(targetCount).fill(0);
      for (const [r, c] of allCells) if (solution[r][c]) kept[blocks[r][c]]++;
      if (Math.min(...kept) >= 1) return { blocks, count: targetCount };
    }
    return null;
  }

  function colourBlocks(size, blocks, count) {
    const neighbours = range(count).map(() => new Set());
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        for (const [nr, nc] of [[r + 1, c], [r, c + 1]]) {
          if (nr < size && nc < size && blocks[nr][nc] !== blocks[r][c]) {
            neighbours[blocks[r][c]].add(blocks[nr][nc]);
            neighbours[blocks[nr][nc]].add(blocks[r][c]);
          }
        }
      }
    }
    const palette = shuffle(BLOCK_COLOURS.slice());
    const used = new Map(palette.map((colour) => [colour, 0]));
    const assigned = Array(count).fill(null);
    const order = range(count).sort((a, b) => neighbours[b].size - neighbours[a].size);
    for (const id of order) {
      const taken = new Set([...neighbours[id]].map((n) => assigned[n]));
      const free = palette.filter((colour) => !taken.has(colour));
      const options = free.length ? free : palette;
      const pick = options.reduce((best, colour) => (used.get(colour) < used.get(best) ? colour : best));
      assigned[id] = pick;
      used.set(pick, used.get(pick) + 1);
    }
    return assigned;
  }

  function lineOptions(line, target) {
    const sums = new Int32Array(1 << line.length);
    const options = [];
    for (let mask = 1; mask < (1 << line.length); mask++) {
      const low = mask & -mask;
      sums[mask] = sums[mask ^ low] + line[31 - Math.clz32(low)];
      if (sums[mask] === target) options.push(mask);
    }
    return options;
  }

  // Narrow the row and column options the way a player would, by ruling cells in or out.
  // Filters the lists in place. Returns false if a contradiction shows there's no answer.
  function deduce(size, values, blocks, blockTargets, rowMasks, colMasks) {
    const full = (1 << size) - 1;
    const mustKeep = Array(size).fill(0);
    const mustDrop = Array(size).fill(0);
    const blockCells = blockTargets.map(() => []);
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) blockCells[blocks[r][c]].push([r, c]);

    let changed = true;
    while (changed) {
      changed = false;

      for (let r = 0; r < size; r++) {
        const keep = mustKeep[r];
        const drop = mustDrop[r];
        rowMasks[r] = rowMasks[r].filter((m) => (m & keep) === keep && !(m & drop));
        if (!rowMasks[r].length) return false;
        let allOf = full;
        let anyOf = 0;
        for (const m of rowMasks[r]) { allOf &= m; anyOf |= m; }
        mustKeep[r] |= allOf;
        mustDrop[r] |= full & ~anyOf;
        if (mustKeep[r] !== keep || mustDrop[r] !== drop) changed = true;
      }

      for (let c = 0; c < size; c++) {
        const bit = 1 << c;
        let keep = 0;
        let drop = 0;
        for (let r = 0; r < size; r++) {
          if (mustKeep[r] & bit) keep |= 1 << r;
          if (mustDrop[r] & bit) drop |= 1 << r;
        }
        colMasks[c] = colMasks[c].filter((m) => (m & keep) === keep && !(m & drop));
        if (!colMasks[c].length) return false;
        let allOf = full;
        let anyOf = 0;
        for (const m of colMasks[c]) { allOf &= m; anyOf |= m; }
        for (let r = 0; r < size; r++) {
          const rowBit = 1 << r;
          if ((allOf & rowBit) && !(mustKeep[r] & bit)) { mustKeep[r] |= bit; changed = true; }
          if (!(anyOf & rowBit) && !(mustDrop[r] & bit)) { mustDrop[r] |= bit; changed = true; }
        }
      }

      for (let b = 0; b < blockTargets.length; b++) {
        const target = blockTargets[b];
        let low = 0;
        let high = 0;
        const open = [];
        for (const [r, c] of blockCells[b]) {
          const bit = 1 << c;
          if (mustKeep[r] & bit) { low += values[r][c]; high += values[r][c]; }
          else if (!(mustDrop[r] & bit)) { high += values[r][c]; open.push([r, c]); }
        }
        if (target < low || target > high) return false;
        for (const [r, c] of open) {
          if (low + values[r][c] > target) { mustDrop[r] |= 1 << c; changed = true; }
          else if (high - values[r][c] < target) { mustKeep[r] |= 1 << c; changed = true; }
        }
      }
    }
    return true;
  }

  // Count the answers matching every target, stopping at limit. Too hard to tell counts as limit.
  function countSolutions(size, values, blocks, rowTargets, colTargets, blockTargets, limit = 2, maxNodes = 500) {
    const rowMasks = range(size).map((r) => lineOptions(values[r], rowTargets[r]));
    const colMasks = range(size).map((c) => lineOptions(values.map((line) => line[c]), colTargets[c]));
    if (!deduce(size, values, blocks, blockTargets, rowMasks, colMasks)) return 0;

    const rowOptions = rowMasks.map((masks) =>
      masks.map((mask) => range(size).filter((c) => (mask >> c) & 1)));
    const order = range(size).sort((a, b) => rowOptions[a].length - rowOptions[b].length);
    const blockTotal = blockTargets.length;

    const colLeft = Array.from({ length: size + 1 }, () => Array(size).fill(0));
    const blockLeft = Array.from({ length: size + 1 }, () => Array(blockTotal).fill(0));
    for (let depth = size - 1; depth >= 0; depth--) {
      const r = order[depth];
      for (let c = 0; c < size; c++) colLeft[depth][c] = colLeft[depth + 1][c] + values[r][c];
      blockLeft[depth] = blockLeft[depth + 1].slice();
      for (let c = 0; c < size; c++) blockLeft[depth][blocks[r][c]] += values[r][c];
    }

    const colSum = Array(size).fill(0);
    const blockSum = Array(blockTotal).fill(0);
    let found = 0;
    let nodes = 0;

    function search(depth) {
      if (depth === size) { found++; return; }
      if (++nodes > maxNodes) { found = limit; return; }
      const r = order[depth];
      const colsAfter = colLeft[depth + 1];
      const blocksAfter = blockLeft[depth + 1];
      for (const option of rowOptions[r]) {
        for (const c of option) {
          colSum[c] += values[r][c];
          blockSum[blocks[r][c]] += values[r][c];
        }
        let possible = true;
        for (let c = 0; possible && c < size; c++) {
          possible = colSum[c] <= colTargets[c] && colTargets[c] <= colSum[c] + colsAfter[c];
        }
        for (let b = 0; possible && b < blockTotal; b++) {
          possible = blockSum[b] <= blockTargets[b] && blockTargets[b] <= blockSum[b] + blocksAfter[b];
        }
        if (possible) search(depth + 1);
        for (const c of option) {
          colSum[c] -= values[r][c];
          blockSum[blocks[r][c]] -= values[r][c];
        }
        if (found >= limit) return;
      }
    }

    search(0);
    return found;
  }

  function generatePuzzle(size) {
    const deadline = performance.now() + GENERATION_BUDGET;
    let fallback = null;
    for (;;) {
      const solution = generateSolution(size);
      const kept = generateKeptValues(size, solution);
      if (!kept) continue;
      const { values, rowTotals, colTotals } = kept;
      addDecoys(size, solution, values, rowTotals);

      // The same numbers often become unique with a different block layout
      for (let i = 0; i < 5; i++) {
        const layout = generateBlocks(size, solution);
        if (!layout) continue;
        const { blocks, count } = layout;
        const blockTargets = Array(count).fill(0);
        for (let r = 0; r < size; r++) {
          for (let c = 0; c < size; c++) if (solution[r][c]) blockTargets[blocks[r][c]] += values[r][c];
        }
        const puzzle = {
          size, values, solution, blocks,
          rowTargets: rowTotals, colTargets: colTotals, blockTargets,
          blockColours: colourBlocks(size, blocks, count),
          unique: false,
        };
        fallback = fallback || puzzle;
        if (countSolutions(size, values, blocks, rowTotals, colTotals, blockTargets) === 1) {
          puzzle.unique = true;
          return puzzle;
        }
        if (performance.now() > deadline) return fallback;
      }
    }
  }

  // Check every number adds up, so a damaged save can't crash the game or be unwinnable.
  // Returns the save if it's good, otherwise null.
  function validateSave(data) {
    try {
      const p = data.puzzle;
      const n = p.size;
      const count = p.blockTargets.length;
      const isGrid = (g) => Array.isArray(g) && g.length === n && g.every((l) => Array.isArray(l) && l.length === n);
      const isCount = (v, low, high) => Number.isInteger(v) && v >= low && v <= high;

      if (!isCount(n, MIN_SIZE, MAX_SIZE) || !isCount(data.lives, 1, LIVES) || !isCount(data.hints, 0, HINTS)) return null;
      if (![p.values, p.solution, p.blocks, data.selected, data.removed].every(isGrid)) return null;
      if (!Array.isArray(p.blockColours) || p.blockColours.length !== count) return null;
      if (!p.blockColours.every((colour) => /^#[0-9a-fA-F]{6}$/.test(colour))) return null;

      const seen = new Set();
      const blockTotals = Array(count).fill(0);
      const rowTotals = Array(n).fill(0);
      const colTotals = Array(n).fill(0);
      let finished = true;
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          const value = p.values[r][c];
          const block = p.blocks[r][c];
          const kept = p.solution[r][c];
          if (!isCount(value, 1, 9) || !isCount(block, 0, count - 1)) return null;
          seen.add(block);
          if (kept) {
            blockTotals[block] += value;
            rowTotals[r] += value;
            colTotals[c] += value;
          }
          if (data.selected[r][c] && (!kept || data.removed[r][c])) return null;
          if (data.removed[r][c] && kept) return null;
          if (!data.selected[r][c] && !data.removed[r][c]) finished = false;
        }
      }
      const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
      if (seen.size !== count || finished) return null;
      if (!same(p.blockTargets, blockTotals) || !same(p.rowTargets, rowTotals) || !same(p.colTargets, colTotals)) return null;
      return data;
    } catch (error) {
      return null;
    }
  }

  return {
    MIN_SIZE, MAX_SIZE, LIVES, HINTS, DOOM_VARIATIONS,
    randInt, choice, grid, generatePuzzle, countSolutions, validateSave,
  };
})();
