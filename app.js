// NumberHunt: the board, touch controls, and game flow.
"use strict";

(() => {
  const TRAY = "#081A30";
  const INK = "#14263C";
  const PAPER = "#F7F9FC";
  const ACCENT = "#35ABEE";
  const TEXT_LIGHT = "#F4F9FF";
  const TEXT_SOFT = "#9CC6EA";
  const WIN_GREEN = "#2BBF7E";
  const LOSS_RED = "#EF4358";
  const FONT = '"Barlow", -apple-system, "Segoe UI", sans-serif';
  const LONG_PRESS_MS = 420;
  const NUMBER_SIZE = 0.44;      // of a cell: small enough to clear the badge in a block's first cell
  const MIN_CELL = 37;           // pixels: new puzzles never make cells smaller than this
  const PHONE_MAX_SIZE = 8;
  const SAVE_KEY = "numberhunt.save.v1";
  const MODE_KEY = "numberhunt.mode";

  const $ = (id) => document.getElementById(id);
  const canvas = $("board");
  const ctx = canvas.getContext("2d");
  const area = $("boardArea");

  // ---------- state ----------
  const game = {
    puzzle: null, selected: [], removed: [], rowSums: [], colSums: [], blockSums: [],
    rowDone: [], colDone: [], blockDone: [],
    lives: NH.LIVES, hints: NH.HINTS, over: false, locked: false, resumePending: false,
    token: 0, mode: "keep", focus: null, press: null,
  };
  const view = { cell: 0, chip: 0, x0: 0, y0: 0, side: 0, dpr: 1, paths: [], fullPaths: [], inset: 1, anchors: [] };
  const anims = new Map();
  let wave = null;
  let frame = null;

  // ---------- small helpers ----------
  const clamp01 = (t) => Math.max(0, Math.min(1, t));

  function parseColour(colour) {
    const hex = colour.replace("#", "");
    return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
  }
  const mixRgb = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  const css = (rgb, alpha = 1) => `rgba(${Math.round(rgb[0])},${Math.round(rgb[1])},${Math.round(rgb[2])},${alpha})`;
  const lighter = (rgb, factor) => rgb.map((v) => Math.min(255, v * factor));
  const easeOutBack = (t) => { const u = t - 1; return 1 + 2.4 * u * u * u + 1.4 * u * u; };

  function roundedRect(target, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    target.moveTo(x + radius, y);
    target.arcTo(x + w, y, x + w, y + h, radius);
    target.arcTo(x + w, y + h, x, y + h, radius);
    target.arcTo(x, y + h, x, y, radius);
    target.arcTo(x, y, x + w, y, radius);
    target.closePath();
  }

  function fillRounded(x, y, w, h, r) {
    ctx.beginPath();
    roundedRect(ctx, x, y, w, h, r);
    ctx.fill();
  }

  function setFont(pixels, weight) { ctx.font = `${weight} ${Math.max(1, pixels)}px ${FONT}`; }

  // Numbers look centred when judged by the digit's own height, not the font's line box
  function drawCentred(text, cx, cy) {
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";    // set first: measurements depend on it
    const m = ctx.measureText("0");
    ctx.fillText(text, cx, cy + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2);
  }

  // ---------- animation ----------
  function animate(key, duration) {
    anims.set(key, { start: performance.now(), duration });
    requestDraw();
  }

  function progress(key) {
    const anim = anims.get(key);
    return anim ? clamp01((performance.now() - anim.start) / anim.duration) : 1;
  }

  function requestDraw() {
    if (frame === null) frame = requestAnimationFrame(tick);
  }

  function tick(now) {
    frame = null;
    for (const [key, anim] of anims) if (now - anim.start >= anim.duration) anims.delete(key);
    draw();
    const waveRunning = wave && now - wave.start < game.puzzle.size * 200 + 260;
    if (anims.size || waveRunning || game.press) requestDraw();
  }

  // ---------- rules ----------
  function recalculate(quiet) {
    const p = game.puzzle;
    const n = p.size;
    game.rowSums = Array(n).fill(0);
    game.colSums = Array(n).fill(0);
    game.blockSums = Array(p.blockTargets.length).fill(0);
    const wrongLeft = Array(p.blockTargets.length).fill(0);

    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (game.selected[r][c]) {
          game.rowSums[r] += p.values[r][c];
          game.colSums[c] += p.values[r][c];
          game.blockSums[p.blocks[r][c]] += p.values[r][c];
        }
        if (!p.solution[r][c] && !game.removed[r][c]) wrongLeft[p.blocks[r][c]]++;
      }
    }
    for (let i = 0; i < n; i++) {
      if (!game.rowDone[i] && game.rowSums[i] === p.rowTargets[i]) {
        game.rowDone[i] = true;
        if (!quiet) animate(`row${i}`, 320);
      }
      if (!game.colDone[i] && game.colSums[i] === p.colTargets[i]) {
        game.colDone[i] = true;
        if (!quiet) animate(`col${i}`, 320);
      }
    }
    // A block is only finished once its total is met AND its wrong numbers have been removed
    p.blockTargets.forEach((target, b) => {
      if (!game.blockDone[b] && game.blockSums[b] === target && !wrongLeft[b]) {
        game.blockDone[b] = true;
        if (!quiet) animate(`block${b}`, 520);
      }
    });
    return game.blockDone.every(Boolean);
  }

  const isOpen = (r, c) => !game.locked && !game.selected[r][c] && !game.removed[r][c];

  function play(r, c, action) {
    if (game.over || !isOpen(r, c)) return;
    const kept = game.puzzle.solution[r][c];
    if (action === "remove" && !kept) {
      game.removed[r][c] = true;
      animate(`fade${r},${c}`, 220);
      afterCorrectMove();
    } else if (action === "keep" && kept) {
      game.selected[r][c] = true;
      animate(`pop${r},${c}`, 260);
      afterCorrectMove();
    } else {
      animate(`shake${r},${c}`, 480);
      if (navigator.vibrate) navigator.vibrate(60);
      game.lives--;
      updateHearts(true);
      if (game.lives <= 0) endGame("loss");
      else saveGame();
    }
    requestDraw();
  }

  function afterCorrectMove() {
    if (recalculate()) endGame("win");
    else saveGame();
  }

  function useHint() {
    if (game.over || game.hints <= 0) return;
    const p = game.puzzle;
    const options = [];
    for (let r = 0; r < p.size; r++) {
      for (let c = 0; c < p.size; c++) if (!p.solution[r][c] && !game.removed[r][c]) options.push([r, c]);
    }
    if (!options.length) return;
    const [r, c] = NH.choice(options);
    game.removed[r][c] = true;
    animate(`fade${r},${c}`, 220);
    game.hints--;
    updateHintButton();
    afterCorrectMove();
    requestDraw();
  }

  function endGame(kind) {
    clearSave();
    game.over = true;
    game.locked = true;
    game.focus = null;
    setWordmark(kind === "win" ? "Solved!" : "Game Over", kind);
    wave = { kind, start: performance.now() };
    requestDraw();
    const token = game.token;
    setTimeout(() => {
      if (game.token === token) showEndCard();
    }, game.puzzle.size * 200 + 500);
  }

  // ---------- starting and saving ----------
  // The largest grid whose cells stay big enough to tap, and for the badge to clear the numbers
  function largestSizeThatFits() {
    const side = Math.min(area.clientWidth, area.clientHeight);
    const fits = Math.floor(side / MIN_CELL - 0.945);
    const isPhone = Math.min(window.innerWidth, window.innerHeight) < 600;
    return Math.max(NH.MIN_SIZE, Math.min(isPhone ? PHONE_MAX_SIZE : NH.MAX_SIZE, fits));
  }

  function newPuzzleSize() {
    return NH.randInt(NH.MIN_SIZE, largestSizeThatFits());
  }

  function loadPuzzle(puzzle) {
    game.puzzle = puzzle;
    const n = puzzle.size;
    view.anchors = Array(puzzle.blockTargets.length).fill(null);
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (!view.anchors[puzzle.blocks[r][c]]) view.anchors[puzzle.blocks[r][c]] = [r, c];
      }
    }
    resetBoard();
    layout();
  }

  function resetBoard() {
    const p = game.puzzle;
    const n = p.size;
    game.selected = NH.grid(n, false);
    game.removed = NH.grid(n, false);
    game.rowDone = Array(n).fill(false);
    game.colDone = Array(n).fill(false);
    game.blockDone = Array(p.blockTargets.length).fill(false);
    game.lives = NH.LIVES;
    game.hints = NH.HINTS;
    game.over = false;
    game.locked = false;
    game.resumePending = false;
    game.focus = null;
    game.press = null;
    game.token++;
    wave = null;
    anims.clear();
    recalculate(true);
    setWordmark(null);
    updateHearts(false);
    updateHintButton();
    hideCard();
    requestDraw();
  }

  function startNewGame() {
    loadPuzzle(NH.generatePuzzle(newPuzzleSize()));
  }

  function restartGame() {
    resetBoard();
    saveGame();
  }

  // Everything is saved after every move, because phones close apps with no warning
  function saveGame() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        puzzle: game.puzzle, selected: game.selected, removed: game.removed,
        lives: game.lives, hints: game.hints,
      }));
    } catch (error) { /* private browsing or storage full: the game still plays */ }
  }

  function clearSave() {
    try { localStorage.removeItem(SAVE_KEY); } catch (error) { /* nothing to clear */ }
  }

  function readSave() {
    let text = null;
    try { text = localStorage.getItem(SAVE_KEY); } catch (error) { return null; }
    if (!text) return null;
    let data = null;
    try { data = NH.validateSave(JSON.parse(text)); } catch (error) { data = null; }
    if (!data) clearSave();     // damaged: it can never load, so don't keep offering it
    return data;
  }

  function offerSavedGame(data) {
    loadPuzzle(data.puzzle);
    game.selected = data.selected;
    game.removed = data.removed;
    game.lives = data.lives;
    game.hints = data.hints;
    recalculate(true);
    anims.clear();
    updateHearts(false);
    updateHintButton();
    game.resumePending = true;
    game.locked = true;
    showCard("Welcome Back!", "#1E93DC", "Would you like to resume your last saved game?", [
      ["Yes, Resume My Game", () => { game.resumePending = false; game.locked = false; hideCard(); }],
      ["No, Start a New Game", startNewGame],
    ]);
    requestDraw();
  }

  function hasProgress() {
    return !game.over && (game.lives < NH.LIVES || game.hints < NH.HINTS
      || game.selected.some((line) => line.some(Boolean)) || game.removed.some((line) => line.some(Boolean)));
  }

  // ---------- cards ----------
  function showCard(title, colour, message, buttons) {
    $("cardTitle").textContent = title;
    $("cardTitle").style.color = colour;
    $("cardMessage").textContent = message;
    const holder = $("cardButtons");
    holder.textContent = "";
    buttons.forEach(([text, action], index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `btn ${index === 0 ? "btn-primary" : "btn-light"}`;
      button.textContent = text;
      button.addEventListener("click", action);
      holder.appendChild(button);
    });
    $("scrim").hidden = false;
  }

  function hideCard() { $("scrim").hidden = true; }

  function showEndCard() {
    if (game.lives > 0) {
      showCard("Congratulations!", "#169A62", "You solved the puzzle. Would you like to play again?", [
        ["Play Again", startNewGame],
        ["Quit", () => showLeaveCard(showEndCard)],
      ]);
    } else {
      showCard("Unlucky!", LOSS_RED, "You failed the puzzle. What would you like to do?", [
        ["Restart Puzzle", restartGame],
        ["New Puzzle", startNewGame],
        ["Leave Game", () => showLeaveCard(showEndCard)],
      ]);
    }
  }

  function showLeaveCard(goBack) {
    showCard("NumberHunt", INK, NH.choice(NH.DOOM_VARIATIONS), [
      ["No, I'm a Man!", goBack],
      ["Yes, I want my Mummy", showGoodbyeCard],
    ]);
  }

  // Apps can't close themselves on iPhone and iPad, so this says how
  function showGoodbyeCard() {
    showCard("Off You Go, Then", INK, "Mummy's on her way. Swipe up to close the game.", [
      ["Actually, One More Go", startNewGame],
    ]);
  }

  // New Puzzle throws away the current game, and buttons are easy to catch on a touchscreen
  function confirmNewPuzzle() {
    if (!hasProgress()) { startNewGame(); return; }
    showCard("NumberHunt", INK, NH.choice(NH.DOOM_VARIATIONS), [
      ["No, I'm a Man!", hideCard],
      ["Yes, I want my Mummy (new puzzle)", startNewGame],
    ]);
  }

  // ---------- header and controls ----------
  const HEART = '<svg class="heart" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21.6C3.6 14.9 1 10.5 1 7.1 1 3.8 3.6 1.9 6.4 1.9c2.4 0 4.5 1.4 5.6 3.3 1.1-1.9 3.2-3.3 5.6-3.3C20.4 1.9 23 3.8 23 7.1c0 3.4-2.6 7.8-11 14.5z"/></svg>';

  function buildHearts() { $("hearts").innerHTML = HEART.repeat(NH.LIVES); }

  function updateHearts(animateLoss) {
    const hearts = $("hearts").children;
    for (let i = 0; i < hearts.length; i++) {
      hearts[i].classList.toggle("lost", i >= game.lives);
      if (animateLoss && i === game.lives) {
        hearts[i].classList.remove("pulse");
        void hearts[i].getBoundingClientRect();
        hearts[i].classList.add("pulse");
      }
    }
    $("hearts").setAttribute("aria-label", `${game.lives} ${game.lives === 1 ? "life" : "lives"} left`);
  }

  function updateHintButton() {
    $("btnHint").textContent = `Hint (${game.hints})`;
    $("btnHint").disabled = game.hints <= 0;
  }

  function setWordmark(status, kind) {
    const mark = $("wordmark");
    if (status) {
      mark.textContent = status;
      mark.className = `wordmark status ${kind}`;
    } else {
      mark.innerHTML = '<span class="wm-a">Number</span><span class="wm-b">Hunt</span>';
      mark.className = "wordmark";
    }
  }

  function setMode(mode) {
    game.mode = mode;
    $("mode").dataset.active = mode;
    for (const button of $("mode").querySelectorAll("button")) {
      button.setAttribute("aria-pressed", String(button.dataset.mode === mode));
    }
    const finger = window.matchMedia("(hover: none)").matches;
    const main = mode === "keep" ? "keep" : "remove";
    const other = mode === "keep" ? "remove" : "keep";
    $("tip").textContent = finger
      ? `Tap to ${main}  ·  Hold to ${other}`
      : `Click to ${main}  ·  Right-click to remove`;
    try { localStorage.setItem(MODE_KEY, mode); } catch (error) { /* just won't be remembered */ }
  }

  // ---------- touch and mouse on the board ----------
  function cellAt(event) {
    const box = canvas.getBoundingClientRect();
    const c = Math.floor((event.clientX - box.left - view.x0) / view.cell);
    const r = Math.floor((event.clientY - box.top - view.y0) / view.cell);
    const n = game.puzzle.size;
    return r >= 0 && r < n && c >= 0 && c < n ? [r, c] : null;
  }

  const opposite = (mode) => (mode === "keep" ? "remove" : "keep");

  function cancelPress() {
    if (game.press) clearTimeout(game.press.timer);
    game.press = null;
    requestDraw();
  }

  canvas.addEventListener("pointerdown", (event) => {
    if (game.locked) return;
    const cell = cellAt(event);
    if (!cell) return;

    if (event.pointerType === "mouse" && event.button === 2) {
      play(cell[0], cell[1], "remove");
      return;
    }
    if (event.button !== 0) return;

    event.preventDefault();
    try { canvas.setPointerCapture(event.pointerId); } catch (error) { /* synthetic events have no capture */ }
    cancelPress();
    game.focus = cell;
    const press = {
      id: event.pointerId, cell, x: event.clientX, y: event.clientY, start: performance.now(),
      timer: setTimeout(() => {
        // Held down: the opposite of the Keep/Remove switch
        if (game.press === press) {
          game.press = null;
          play(cell[0], cell[1], opposite(game.mode));
          if (event.pointerType !== "mouse") game.focus = null;
          requestDraw();
        }
      }, LONG_PRESS_MS),
    };
    game.press = isOpen(cell[0], cell[1]) ? press : null;
    if (!game.press) clearTimeout(press.timer);
    requestDraw();
  });

  canvas.addEventListener("pointermove", (event) => {
    if (game.press && event.pointerId === game.press.id) {
      // A finger that slides away has changed its mind
      if (Math.hypot(event.clientX - game.press.x, event.clientY - game.press.y) > Math.max(12, view.cell * 0.4)) {
        cancelPress();
        game.focus = null;
      }
      return;
    }
    if (event.pointerType === "mouse" && !game.locked) {
      const cell = cellAt(event);
      const same = cell && game.focus && cell[0] === game.focus[0] && cell[1] === game.focus[1];
      if (!same && (cell || game.focus)) {
        game.focus = cell;
        requestDraw();
      }
    }
  });

  canvas.addEventListener("pointerup", (event) => {
    if (game.press && event.pointerId === game.press.id) {
      const [r, c] = game.press.cell;
      cancelPress();
      play(r, c, game.mode);
    }
    if (event.pointerType !== "mouse") game.focus = null;
    requestDraw();
  });

  canvas.addEventListener("pointercancel", () => { cancelPress(); game.focus = null; });
  canvas.addEventListener("pointerleave", (event) => {
    if (event.pointerType === "mouse" && !game.press) { game.focus = null; requestDraw(); }
  });
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  document.addEventListener("gesturestart", (event) => event.preventDefault());

  // ---------- layout ----------
  function layout() {
    if (!game.puzzle) return;
    const width = area.clientWidth;
    const height = area.clientHeight;
    const side = Math.min(width, height);
    if (side <= 0) return;

    view.dpr = window.devicePixelRatio || 1;
    view.side = side;
    canvas.style.width = `${side}px`;
    canvas.style.height = `${side}px`;
    canvas.style.left = `${(width - side) / 2}px`;
    canvas.style.top = `${(height - side) / 2}px`;
    canvas.width = Math.round(side * view.dpr);
    canvas.height = Math.round(side * view.dpr);

    const n = game.puzzle.size;
    // Across the canvas: a chip (0.8), its gap (0.09), the grid (n), and the tray's border (0.055)
    view.cell = side / (n + 0.945);
    view.chip = view.cell * 0.8;
    view.x0 = view.chip + view.cell * 0.09;
    view.y0 = view.x0;
    view.inset = Math.max(1, view.cell * 0.022);

    const blocks = game.puzzle.blocks;
    const count = game.puzzle.blockTargets.length;
    view.paths = [];
    view.fullPaths = [];
    for (let b = 0; b < count; b++) {
      view.paths.push(blockOutline(n, blocks, b, view.inset, view.cell * 0.15));
      view.fullPaths.push(blockOutline(n, blocks, b, 0, 0));
    }
    requestDraw();
  }

  // Trace a block's outline as one smooth path with rounded corners, however odd its shape
  function blockOutline(n, blocks, id, inset, radius) {
    const edges = new Map();
    const key = (x, y) => `${x},${y}`;
    const addEdge = (a, b) => {
      if (!edges.has(key(a[0], a[1]))) edges.set(key(a[0], a[1]), []);
      edges.get(key(a[0], a[1])).push(b);
    };
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (blocks[r][c] !== id) continue;
        if (r === 0 || blocks[r - 1][c] !== id) addEdge([c, r], [c + 1, r]);
        if (c === n - 1 || blocks[r][c + 1] !== id) addEdge([c + 1, r], [c + 1, r + 1]);
        if (r === n - 1 || blocks[r + 1][c] !== id) addEdge([c + 1, r + 1], [c, r + 1]);
        if (c === 0 || blocks[r][c - 1] !== id) addEdge([c, r + 1], [c, r]);
      }
    }

    const path = new Path2D();
    const sign = Math.sign;

    while (edges.size) {
      const startKey = edges.keys().next().value;
      const start = startKey.split(",").map(Number);
      const loop = [start];
      let current = start;
      let direction = null;
      for (;;) {
        const options = edges.get(key(current[0], current[1]));
        let chosen = options[0];
        if (direction && options.length > 1) {
          // Where two corners touch, keep hugging the same cell by turning right
          const right = [-direction[1], direction[0]];
          for (const option of options) {
            if (option[0] - current[0] === right[0] && option[1] - current[1] === right[1]) chosen = option;
          }
        }
        options.splice(options.indexOf(chosen), 1);
        if (!options.length) edges.delete(key(current[0], current[1]));
        direction = [chosen[0] - current[0], chosen[1] - current[1]];
        current = chosen;
        if (current[0] === start[0] && current[1] === start[1]) break;
        loop.push(current);
      }

      // Keep only the true corners
      const corners = loop.filter((point, i) => {
        const before = loop[(i - 1 + loop.length) % loop.length];
        const after = loop[(i + 1) % loop.length];
        return point[0] - before[0] !== after[0] - point[0] || point[1] - before[1] !== after[1] - point[1];
      });

      // Inset each corner (the inside is always to the right of travel), then round it
      corners.forEach((point, i) => {
        const before = corners[(i - 1 + corners.length) % corners.length];
        const after = corners[(i + 1) % corners.length];
        const d1 = [sign(point[0] - before[0]), sign(point[1] - before[1])];
        const d2 = [sign(after[0] - point[0]), sign(after[1] - point[1])];
        const x = view.x0 + point[0] * view.cell + (-d1[1] - d2[1]) * inset;
        const y = view.y0 + point[1] * view.cell + (d1[0] + d2[0]) * inset;
        const inX = x - d1[0] * radius;
        const inY = y - d1[1] * radius;
        if (i === 0) path.moveTo(inX, inY);
        else path.lineTo(inX, inY);
        path.quadraticCurveTo(x, y, x + d2[0] * radius, y + d2[1] * radius);
      });
      path.closePath();
    }
    return path;
  }

  // ---------- painting ----------
  const solvedAmount = (b) => (game.blockDone[b] ? progress(`block${b}`) : 0);

  function fillBlock(b, path) {
    const amount = solvedAmount(b);
    const base = parseColour(game.puzzle.blockColours[b]);
    const paper = parseColour(PAPER);
    const anchor = view.anchors[b];
    // A vertical sheen across the board; fades to flat white so touching solved blocks show no seam
    const top = view.y0 + anchor[0] * view.cell;
    const gradient = ctx.createLinearGradient(0, top, 0, view.y0 + game.puzzle.size * view.cell);
    gradient.addColorStop(0, css(mixRgb(lighter(base, 1.03), paper, amount)));
    gradient.addColorStop(1, css(mixRgb(lighter(base, 0.95), paper, amount)));
    ctx.fillStyle = gradient;
    ctx.fill(path, "evenodd");
  }

  function paintBlocks() {
    const n = game.puzzle.size;
    const count = view.paths.length;
    const paper = parseColour(PAPER);

    // Solved blocks grow out to fill the gap around them, which removes their outline
    ctx.save();
    ctx.beginPath();
    roundedRect(ctx, view.x0, view.y0, view.cell * n, view.cell * n, view.cell * 0.15);
    ctx.clip();
    for (let b = 0; b < count; b++) {
      if (!game.blockDone[b]) continue;
      const amount = solvedAmount(b);
      ctx.globalAlpha = amount;
      fillBlock(b, view.fullPaths[b]);
      ctx.strokeStyle = css(mixRgb(parseColour(game.puzzle.blockColours[b]), paper, amount));
      ctx.lineWidth = 1.5;
      ctx.stroke(view.fullPaths[b]);    // seals the hairline seam between touching shapes
    }
    ctx.restore();
    for (let b = 0; b < count; b++) if (game.blockDone[b]) fillBlock(b, view.paths[b]);

    // Unsolved blocks keep their dark outline, including where they meet a solved block
    ctx.strokeStyle = TRAY;
    ctx.lineWidth = view.inset * 4;
    for (let b = 0; b < count; b++) if (!game.blockDone[b]) ctx.stroke(view.paths[b]);
    for (let b = 0; b < count; b++) if (!game.blockDone[b]) fillBlock(b, view.paths[b]);

    paintCellLines();

    // A soft light edge gives each block a little depth; solved blocks lose this too
    ctx.lineWidth = Math.max(1, view.cell * 0.014);
    for (let b = 0; b < count; b++) {
      const alpha = 0.43 * (1 - solvedAmount(b));
      if (alpha > 0) {
        ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
        ctx.stroke(view.paths[b]);
      }
    }
  }

  function line(x1, y1, x2, y2) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  function paintCellLines() {
    const n = game.puzzle.size;
    const blocks = game.puzzle.blocks;
    ctx.lineWidth = 1;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const here = blocks[r][c];
        const x = view.x0 + c * view.cell;
        const y = view.y0 + r * view.cell;
        const edge = (next, x1, y1, x2, y2) => {
          if (next === here) {
            ctx.strokeStyle = "rgba(20,38,60,0.1)";
            line(x1, y1, x2, y2);
          } else if (game.blockDone[here] && game.blockDone[next]) {
            ctx.strokeStyle = `rgba(20,38,60,${0.1 * Math.min(solvedAmount(here), solvedAmount(next))})`;
            line(x1, y1, x2, y2);
          }
        };
        if (c + 1 < n) edge(blocks[r][c + 1], x + view.cell, y + 1, x + view.cell, y + view.cell - 1);
        if (r + 1 < n) edge(blocks[r + 1][c], x + 1, y + view.cell, x + view.cell - 1, y + view.cell);
      }
    }
  }

  function paintFocus() {
    if (!game.focus || game.locked) return;
    const n = game.puzzle.size;
    const [r, c] = game.focus;
    ctx.fillStyle = "rgba(255,255,255,0.14)";
    for (let i = 0; i < n; i++) {
      if (i !== c) ctx.fillRect(view.x0 + i * view.cell + 1, view.y0 + r * view.cell + 1, view.cell - 2, view.cell - 2);
      if (i !== r) ctx.fillRect(view.x0 + c * view.cell + 1, view.y0 + i * view.cell + 1, view.cell - 2, view.cell - 2);
    }
    if (isOpen(r, c)) {
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      fillRounded(view.x0 + c * view.cell + 3, view.y0 + r * view.cell + 3, view.cell - 6, view.cell - 6, view.cell * 0.12);
    }
  }

  function waveAmount(r, c) {
    if (!wave) return 0;
    return clamp01((performance.now() - wave.start - (r + c) * 100) / 240);
  }

  function paintCell(r, c) {
    const cell = view.cell;
    const x = view.x0 + c * cell;
    const y = view.y0 + r * cell;
    const cx = x + cell / 2;
    const cy = y + cell / 2;
    const value = String(game.puzzle.values[r][c]);
    const amount = waveAmount(r, c);
    const kind = wave ? wave.kind : null;
    const ink = parseColour(INK);
    const white = [255, 255, 255];

    if (kind === "loss" && amount > 0) {
      ctx.fillStyle = css(parseColour(LOSS_RED), 0.9 * amount);
      fillRounded(x + 2, y + 2, cell - 4, cell - 4, cell * 0.12);
    }

    if (game.removed[r][c]) {
      const fade = progress(`fade${r},${c}`);
      if (fade < 1) {
        setFont(cell * NUMBER_SIZE, 500);
        ctx.fillStyle = css(ink, 1 - fade);
        drawCentred(value, cx, cy);
      }
      return;
    }

    if (game.selected[r][c]) {
      const radius = Math.max(0, cell * 0.36 * easeOutBack(progress(`pop${r},${c}`)));
      let fill = parseColour(PAPER);
      let ring = ink;
      let text = ink;
      if (kind === "win") {
        fill = mixRgb(fill, parseColour(WIN_GREEN), amount);
        ring = mixRgb(ring, parseColour("#148A58"), amount);
        text = mixRgb(text, white, amount);
      }
      ctx.fillStyle = "rgba(20,38,60,0.16)";
      ctx.beginPath();
      ctx.arc(cx, cy + cell * 0.022, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fillStyle = css(fill);
      ctx.fill();
      ctx.strokeStyle = css(ring);
      ctx.lineWidth = Math.max(1.5, cell * 0.036);
      ctx.stroke();
      setFont(cell * NUMBER_SIZE, 600);
      ctx.fillStyle = css(text);
      drawCentred(value, cx, cy);
      return;
    }

    let offset = 0;
    const shakeKey = `shake${r},${c}`;
    if (anims.has(shakeKey)) {
      const t = progress(shakeKey);
      offset = Math.sin(t * Math.PI * 6) * cell * 0.07 * (1 - t);
      ctx.fillStyle = css(parseColour(LOSS_RED), 0.88 * (1 - t));
      fillRounded(x + 3 + offset, y + 3, cell - 6, cell - 6, cell * 0.12);
    }

    // A ring closes around a number being held, showing the long press is on its way
    if (game.press && game.press.cell[0] === r && game.press.cell[1] === c) {
      const t = clamp01((performance.now() - game.press.start - 90) / (LONG_PRESS_MS - 90));
      if (t > 0) {
        ctx.strokeStyle = opposite(game.mode) === "remove" ? LOSS_RED : INK;
        ctx.lineWidth = Math.max(2.5, cell * 0.06);
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.arc(cx, cy, cell * 0.36, -Math.PI / 2, -Math.PI / 2 + t * Math.PI * 2);
        ctx.stroke();
        ctx.lineCap = "butt";
      }
    }

    setFont(cell * NUMBER_SIZE, 500);
    ctx.fillStyle = kind === "loss" ? css(mixRgb(ink, white, amount)) : INK;
    drawCentred(value, cx + offset, cy);
  }

  function paintBadges() {
    const size = Math.max(9, view.cell * 0.2);
    setFont(size, 600);
    const margin = view.cell * 0.035;
    const height = size * 1.22;
    game.puzzle.blockTargets.forEach((target, b) => {
      const [r, c] = view.anchors[b];
      const current = game.blockSums[b];
      const done = game.blockDone[b];
      const text = done || !current ? String(target) : `${current}/${target}`;
      const width = ctx.measureText(text).width + size * 0.5;
      const x = view.x0 + c * view.cell + margin;
      const y = view.y0 + r * view.cell + margin;
      ctx.fillStyle = done ? WIN_GREEN : "rgba(255,255,255,0.9)";
      fillRounded(x, y, width, height, height * 0.3);
      ctx.fillStyle = done ? "#FFFFFF" : INK;
      drawCentred(text, x + width / 2, y + height / 2);
    });
  }

  function paintChip(x, y, w, h, target, current, done, key, highlighted) {
    const cell = view.cell;
    const amount = done ? progress(key) : 0;
    const base = [150, 205, 255];
    const green = parseColour(WIN_GREEN);
    const alpha = highlighted ? 0.28 : 0.135;
    ctx.fillStyle = css(mixRgb(base, green, amount), alpha + (1 - alpha) * amount);
    fillRounded(x, y, w, h, cell * 0.13);
    ctx.strokeStyle = "rgba(170,215,255,0.24)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    roundedRect(ctx, x, y, w, h, cell * 0.13);
    ctx.stroke();

    setFont(cell * 0.36, 600);
    ctx.fillStyle = TEXT_LIGHT;
    drawCentred(String(target), x + w / 2, y + h / 2 + cell * 0.022);

    if (done) {
      const s = cell * 0.13;
      const tx = x + w - s - cell * 0.07;
      const ty = y + cell * 0.07;
      ctx.strokeStyle = "#FFFFFF";
      ctx.lineWidth = Math.max(1.5, cell * 0.024);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(tx, ty + s * 0.55);
      ctx.lineTo(tx + s * 0.38, ty + s * 0.92);
      ctx.lineTo(tx + s, ty + s * 0.12);
      ctx.stroke();
      ctx.lineCap = "butt";
      ctx.lineJoin = "miter";
    } else {
      setFont(Math.max(9, cell * 0.165), 500);
      ctx.fillStyle = TEXT_SOFT;
      ctx.textAlign = "right";
      ctx.textBaseline = "top";
      ctx.fillText(String(current), x + w - cell * 0.07, y + cell * 0.05);
      if (current) {
        const barH = Math.max(2, cell * 0.035);
        const inner = w - cell * 0.2;
        ctx.fillStyle = ACCENT;
        fillRounded(x + cell * 0.1, y + h - barH - cell * 0.05, inner * Math.min(1, current / target), barH, barH / 2);
      }
    }
  }

  function draw() {
    if (!game.puzzle || !view.paths.length) return;
    const n = game.puzzle.size;
    const cell = view.cell;
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.clearRect(0, 0, view.side, view.side);

    const pad = cell * 0.05;
    ctx.fillStyle = TRAY;
    fillRounded(view.x0 - pad, view.y0 - pad, cell * n + pad * 2, cell * n + pad * 2, cell * 0.2);
    ctx.strokeStyle = "rgba(150,205,255,0.18)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    roundedRect(ctx, view.x0 - pad, view.y0 - pad, cell * n + pad * 2, cell * n + pad * 2, cell * 0.2);
    ctx.stroke();

    paintBlocks();
    paintFocus();
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) paintCell(r, c);
    paintBadges();

    const inset = cell * 0.05;
    const chipGap = cell * 0.09;
    const focus = game.focus && !game.locked ? game.focus : [null, null];
    for (let i = 0; i < n; i++) {
      paintChip(view.x0 + i * cell + inset, view.y0 - view.chip - chipGap, cell - inset * 2, view.chip,
        game.puzzle.colTargets[i], game.colSums[i], game.colDone[i], `col${i}`, i === focus[1]);
      paintChip(view.x0 - view.chip - chipGap, view.y0 + i * cell + inset, view.chip, cell - inset * 2,
        game.puzzle.rowTargets[i], game.rowSums[i], game.rowDone[i], `row${i}`, i === focus[0]);
    }
  }

  // ---------- start up ----------
  for (const button of $("mode").querySelectorAll("button")) {
    button.addEventListener("click", () => setMode(button.dataset.mode));
  }
  $("btnHint").addEventListener("click", useHint);
  $("btnRestart").addEventListener("click", restartGame);
  $("btnNew").addEventListener("click", confirmNewPuzzle);

  new ResizeObserver(layout).observe(area);
  window.addEventListener("orientationchange", () => setTimeout(layout, 250));

  buildHearts();
  let savedMode = "keep";
  try { savedMode = localStorage.getItem(MODE_KEY) === "remove" ? "remove" : "keep"; } catch (error) { /* default */ }
  setMode(savedMode);

  const saved = readSave();
  if (saved) offerSavedGame(saved);
  else startNewGame();

  // Numbers are drawn on a canvas, so redraw once the font has arrived
  if (document.fonts) {
    Promise.all([300, 500, 600, 700].map((w) => document.fonts.load(`${w} 20px Barlow`)))
      .then(requestDraw, requestDraw);
  }

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => { /* still works, just not offline */ });
  }

  // For the automated tests in tests.js
  window.__numberHunt = { game, view, startSized: (size) => loadPuzzle(NH.generatePuzzle(size)) };
})();
