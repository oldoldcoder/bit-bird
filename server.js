const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.static(__dirname));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// 游戏参数（与前端一致）
const GAME_PARAMS = {
  gravity: 0.4,
  jumpForce: -9,
  pipeSpeed: 2,
  pipeGap: 150,
  pipeWidth: 80,
  canvasWidth: 800,
  canvasHeight: 600,
  birdSize: 24,
};

const ROOM = {
  clients: [], // {ws, id, ready}
  state: null,
  interval: null,
  countdownTimer: null,
  started: false,
};

function createInitialState() {
  return {
    score: 0,
    birds: [
      { x: 220, y: 300, v: 0, alive: true }, // 先连在前，靠前一些
      { x: 160, y: 320, v: 0, alive: true }, // 后连稍后，并在垂直方向错开
    ],
    pipes: [],
    pipeTimer: 0,
    pipeInterval: 120,
    winner: null,
  };
}

function broadcast(data) {
  const message = JSON.stringify(data);
  ROOM.clients.forEach(c => {
    if (c.ws.readyState === WebSocket.OPEN) {
      c.ws.send(message);
    }
  });
}

function addClient(ws) {
  if (ROOM.clients.length >= 2) {
    ws.send(JSON.stringify({ type: 'room_full' }));
    ws.close();
    return;
  }
  const id = ROOM.clients.length + 1; // 1 或 2
  ROOM.clients.push({ ws, id, ready: false });
  ws.send(JSON.stringify({ type: 'joined', id }));
  if (ROOM.clients.length === 2) {
    broadcast({ type: 'room_ready' });
  }
}

function removeClient(ws) {
  ROOM.clients = ROOM.clients.filter(c => c.ws !== ws);
  stopGameLoop();
}

function bothReady() {
  if (ROOM.clients.length < 2) return false;
  return ROOM.clients.every(c => c.ready);
}

function startCountdown() {
  if (ROOM.started || ROOM.clients.length < 2) return;
  let n = 3;
  broadcast({ type: 'countdown', value: n });
  ROOM.countdownTimer = setInterval(() => {
    n -= 1;
    if (n > 0) {
      broadcast({ type: 'countdown', value: n });
    } else {
      clearInterval(ROOM.countdownTimer);
      ROOM.countdownTimer = null;
      startGameLoop();
    }
  }, 1000);
}

function startGameLoop() {
  ROOM.started = true;
  ROOM.state = createInitialState();
  broadcast({ type: 'start', params: GAME_PARAMS });
  const tickRate = 1000 / 60;
  ROOM.interval = setInterval(() => {
    const s = ROOM.state;
    if (!s) return; // 状态可能被清空（例如客户端断开后的竞态）
    step(s);
    broadcast({ type: 'state', state: s });
    if (s.winner) {
      broadcast({ type: 'game_over', winner: ROOM.state.winner, score: ROOM.state.score });
      stopGameLoop();
    }
  }, tickRate);
}

function stopGameLoop() {
  if (ROOM.interval) clearInterval(ROOM.interval);
  ROOM.interval = null;
  if (ROOM.countdownTimer) clearInterval(ROOM.countdownTimer);
  ROOM.countdownTimer = null;
  ROOM.started = false;
  ROOM.state = null;
}

function handleJump(playerId) {
  const s = ROOM.state;
  if (!s || s.winner) return;
  const bird = s.birds[playerId - 1];
  if (!bird || !bird.alive) return;
  bird.v = GAME_PARAMS.jumpForce;
}

function handleReady(ws) {
  const client = ROOM.clients.find(c => c.ws === ws);
  if (!client) return;
  client.ready = true;
  broadcast({ type: 'player_ready', id: client.id });
  if (!ROOM.started && !ROOM.countdownTimer && bothReady()) {
    startCountdown();
  }
}

function step(state) {
  // 生成管道
  state.pipeTimer += 1;
  if (state.pipeTimer >= state.pipeInterval) {
    state.pipeTimer = 0;
    const gapY = Math.random() * (GAME_PARAMS.canvasHeight - GAME_PARAMS.pipeGap - 100) + 50;
    state.pipes.push({ x: GAME_PARAMS.canvasWidth, gapY, passed: false });
  }

  // 更新管道
  for (let i = state.pipes.length - 1; i >= 0; i--) {
    const p = state.pipes[i];
    p.x -= GAME_PARAMS.pipeSpeed;
    if (p.x + GAME_PARAMS.pipeWidth < 0) {
      state.pipes.splice(i, 1);
      continue;
    }
    if (!p.passed && p.x + GAME_PARAMS.pipeWidth < state.birds[0].x) {
      p.passed = true;
      state.score += 1;
    }
  }

  // 更新小鸟
  state.birds.forEach(b => {
    if (!b.alive) return;
    b.v += GAME_PARAMS.gravity;
    b.y += b.v;
    if (b.y < 0) {
      b.y = 0; b.v = 0;
    }
    if (b.y > GAME_PARAMS.canvasHeight - GAME_PARAMS.birdSize) {
      b.alive = false;
      b.y = GAME_PARAMS.canvasHeight - GAME_PARAMS.birdSize; // 卡在地面，不再穿透
    }
  });

  // 碰撞检测
  state.pipes.forEach(p => {
    state.birds.forEach(b => {
      if (!b.alive) return;
      const birdRight = b.x + GAME_PARAMS.birdSize;
      const birdLeft = b.x;
      const birdTop = b.y;
      const birdBottom = b.y + GAME_PARAMS.birdSize;
      const pipeLeft = p.x;
      const pipeRight = p.x + GAME_PARAMS.pipeWidth;
      const pipeTop = p.gapY;
      const pipeBottom = p.gapY + GAME_PARAMS.pipeGap;
      if (birdRight > pipeLeft && birdLeft < pipeRight && (birdTop < pipeTop || birdBottom > pipeBottom)) {
        b.alive = false;
      }
    });
  });

  const alive = state.birds.map(b => b.alive);
  if (!alive[0] && alive[1]) state.winner = 2;
  if (!alive[1] && alive[0]) state.winner = 1;
  if (!alive[0] && !alive[1]) state.winner = 0; // 平局
}

wss.on('connection', ws => {
  addClient(ws);
  ws.on('message', data => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    if (msg.type === 'ready') handleReady(ws);
    if (msg.type === 'jump' && typeof msg.playerId === 'number') handleJump(msg.playerId);
  });
  ws.on('close', () => removeClient(ws));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on http://0.0.0.0:${PORT}`);
});


