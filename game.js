class PixelBirdGame {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');
        // 固定画布的 CSS 尺寸，避免状态切换引起缩放
        this.canvas.style.width = this.canvas.width + 'px';
        this.canvas.style.height = this.canvas.height + 'px';
        this.scoreElement = document.getElementById('score');
        this.scoreDisplayDiv = document.querySelector('.score-display');
        this.controlsDiv = document.querySelector('.game-controls');
        this.restartBtn = document.getElementById('restartBtn');
        this.gameOverDiv = document.getElementById('gameOver');
        this.finalScoreElement = document.getElementById('finalScore');
        this.playAgainBtn = document.getElementById('playAgainBtn');
        // 新增：模式与联机控件
        this.singleBtn = document.getElementById('singleBtn');
        this.multiBtn = document.getElementById('multiBtn');
        this.waitingOverlay = document.getElementById('waiting');
        this.waitingText = document.getElementById('waitingText');
        this.readyStartBtn = document.getElementById('readyStartBtn');
        this.countdownEl = document.getElementById('countdown');
        this.playerNameInput = document.getElementById('playerName');
        this.playerColorInput = document.getElementById('playerColor');
        
        // 游戏状态
        this.gameRunning = false;
        this.gameOver = false;
        this.score = 0;
        this.mode = 'single'; // single | multi
        this.isMultiplayer = false;
        this.ws = null;
        this.playerId = null;
        this.serverState = null; // 服务端 authoritative 状态
        
        // 游戏参数
        this.gravity = 0.4;
        this.jumpForce = -9;
        this.pipeSpeed = 2;
        this.pipeGap = 150;
        this.pipeWidth = 80;
        
        // 小鸟对象
        this.bird = {
            x: 150,
            y: 300,
            velocity: 0,
            size: 24
        };
        
        // 管道数组
        this.pipes = [];
        this.pipeTimer = 0;
        this.pipeInterval = 120;
        
        // 背景云朵
        this.clouds = [];
        this.initClouds();

        // 音效相关
        this.audioCtx = null;           // 延迟创建
        this.hitSoundPlayed = false;    // 防止重复播放碰撞音
        
        // 绑定事件
        this.bindEvents();
        
        // 初始化游戏
        this.init();

        // 隐藏外部的 DOM 分数显示，改为画布内显示
        if (this.scoreDisplayDiv) {
            this.scoreDisplayDiv.style.display = 'none';
        }

        // 锁定控制栏高度，避免按钮显示/隐藏导致容器高度变化
        if (this.controlsDiv) {
            const h = this.controlsDiv.offsetHeight;
            if (h > 0) this.controlsDiv.style.height = h + 'px';
        }

        // 初始化按钮可见性（使用 visibility 保留占位）
        if (this.restartBtn) this.restartBtn.style.visibility = 'hidden';
    }
    
    init() {
        this.drawStartScreen();
    }
    
    initClouds() {
        for (let i = 0; i < 5; i++) {
            this.clouds.push({
                x: Math.random() * this.canvas.width,
                y: Math.random() * 200 + 50,
                size: Math.random() * 30 + 20,
                speed: Math.random() * 0.5 + 0.2
            });
        }
    }
    
    
    
    bindEvents() {
        // 重新开始按钮
        this.restartBtn.addEventListener('click', () => this.startGame());
        
        // 再玩一次按钮
        this.playAgainBtn.addEventListener('click', () => {
            if (this.mode === 'single') {
                this.startGame();
            } else {
                this.returnToReadyLobby();
            }
        });

        // 模式选择：点击即开局并隐藏模式按钮
        if (this.singleBtn) this.singleBtn.addEventListener('click', () => { this.setMode('single'); this.startGame(); this.hideModeButtons(); });
        if (this.multiBtn) this.multiBtn.addEventListener('click', () => { this.setMode('multi'); this.startMultiplayer(); this.hideModeButtons(); });
        if (this.readyStartBtn) this.readyStartBtn.addEventListener('click', () => this.sendReady());

        // 等待界面：昵称与颜色变化即上报
        if (this.playerNameInput) {
            this.playerNameInput.addEventListener('change', () => this.sendNameIfAny());
            this.playerNameInput.addEventListener('blur', () => this.sendNameIfAny());
            this.playerNameInput.addEventListener('keyup', (e) => { if (e.key === 'Enter') this.sendNameIfAny(); });
        }
        if (this.playerColorInput) {
            this.playerColorInput.addEventListener('change', () => this.sendColorIfAny());
            this.playerColorInput.addEventListener('input', () => this.sendColorIfAny());
        }
        
        // 键盘事件
        document.addEventListener('keydown', (e) => {
            if (e.code === 'Space' && this.gameRunning) {
                e.preventDefault();
                if (this.mode === 'single') {
                    this.jump();
                } else {
                    // 多人：向服务器发送跳跃
                    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.playerId) {
                        this.ws.send(JSON.stringify({ type: 'jump', playerId: this.playerId }));
                    }
                }
            }
        });
        
        // 鼠标/触摸事件
        this.canvas.addEventListener('click', () => {
            if (this.gameRunning) this.jump();
        });
        
        this.canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            if (this.gameRunning) this.jump();
        });
    }
    
    startGame() {
        this.gameRunning = true;
        this.gameOver = false;
        this.hitSoundPlayed = false;
        this.score = 0;
        this.bird.y = 300;
        this.bird.velocity = 0;
        this.pipes = [];
        this.pipeTimer = 0;
        
        this.restartBtn.style.visibility = 'visible';
        this.gameOverDiv.style.display = 'none';
        
        this.updateScore();
        if (this.mode === 'single') {
            this.gameLoop();
        }
    }

    hideModeButtons() {
        const mode = document.querySelector('.mode-select');
        if (mode) mode.style.display = 'none';
    }
    
    jump() {
        if (this.gameRunning && !this.gameOver) {
            this.bird.velocity = this.jumpForce;
            this.playJumpSound();
        }
    }
    
    updateBird() {
        if (!this.gameRunning) return;
        
        this.bird.velocity += this.gravity;
        this.bird.y += this.bird.velocity;
        
        // 边界检测
        if (this.bird.y < 0) {
            this.bird.y = 0;
            this.bird.velocity = 0;
        }
        
        // 使用原始尺寸进行边界检测
        const birdHeight = this.bird.size;
        if (this.bird.y > this.canvas.height - birdHeight) {
            this.triggerGameOver();
        }
    }
    
    updatePipes() {
        if (!this.gameRunning) return;
        
        this.pipeTimer++;
        
        // 生成新管道
        if (this.pipeTimer >= this.pipeInterval) {
            this.pipeTimer = 0;
            const gapY = Math.random() * (this.canvas.height - this.pipeGap - 100) + 50;
            
            this.pipes.push({
                x: this.canvas.width,
                gapY: gapY,
                passed: false
            });
        }
        
        // 更新管道位置
        for (let i = this.pipes.length - 1; i >= 0; i--) {
            const pipe = this.pipes[i];
            pipe.x -= this.pipeSpeed;
            
            // 移除超出屏幕的管道
            if (pipe.x + this.pipeWidth < 0) {
                this.pipes.splice(i, 1);
                continue;
            }
            
            // 检查是否通过管道
            if (!pipe.passed && pipe.x + this.pipeWidth < this.bird.x) {
                pipe.passed = true;
                this.score++;
                this.updateScore();
            }
            
            // 碰撞检测
            if (this.checkCollision(pipe)) {
                this.triggerGameOver();
            }
        }
    }
    
    checkCollision(pipe) {
        // 小鸟碰撞范围（恢复为原始像素尺寸）
        const birdWidth = this.bird.size;
        const birdHeight = this.bird.size;
        
        const birdRight = this.bird.x + birdWidth;
        const birdLeft = this.bird.x;
        const birdTop = this.bird.y;
        const birdBottom = this.bird.y + birdHeight;
        
        const pipeLeft = pipe.x;
        const pipeRight = pipe.x + this.pipeWidth;
        const pipeTop = pipe.gapY;
        const pipeBottom = pipe.gapY + this.pipeGap;
        
        // 检查是否与上管道碰撞
        if (birdRight > pipeLeft && birdLeft < pipeRight && birdTop < pipeTop) {
            return true;
        }
        
        // 检查是否与下管道碰撞
        if (birdRight > pipeLeft && birdLeft < pipeRight && birdBottom > pipeBottom) {
            return true;
        }
        
        return false;
    }
    
    updateClouds() {
        this.clouds.forEach(cloud => {
            cloud.x -= cloud.speed;
            if (cloud.x + cloud.size < 0) {
                cloud.x = this.canvas.width + cloud.size;
                cloud.y = Math.random() * 200 + 50;
            }
        });
    }
    
    updateScore() {
        this.scoreElement.textContent = this.score;
    }
    
    drawBird() {
        this.ctx.save();
        
        // 身体（正方形，纯像素风格）
        const bodySize = this.bird.size;
        this.ctx.fillStyle = '#FFD700';
        this.ctx.fillRect(this.bird.x, this.bird.y, bodySize, bodySize);
        
        // 翅膀（加大面积并加描边以更突出）
        const wingX = this.bird.x + bodySize * 0.12;
        const wingY = this.bird.y + bodySize * 0.38;
        const wingW = bodySize * 0.52;
        const wingH = bodySize * 0.34;
        this.ctx.fillStyle = '#FFA500';
        this.ctx.fillRect(wingX, wingY, wingW, wingH);
        this.ctx.strokeStyle = '#CC6E00';
        this.ctx.lineWidth = Math.max(1, bodySize * 0.06);
        this.ctx.strokeRect(wingX + 0.5, wingY + 0.5, wingW - 1, wingH - 1);
        
        // 嘴巴（小矩形）
        this.ctx.fillStyle = '#FF6B35';
        this.ctx.fillRect(this.bird.x + bodySize * 0.75, this.bird.y + bodySize * 0.4, bodySize * 0.3, bodySize * 0.2);
        
        // 眼睛（小像素点）
        this.ctx.fillStyle = '#FFFFFF';
        this.ctx.fillRect(this.bird.x + bodySize * 0.55, this.bird.y + bodySize * 0.25, bodySize * 0.2, bodySize * 0.2);
        this.ctx.fillStyle = '#000000';
        this.ctx.fillRect(this.bird.x + bodySize * 0.6, this.bird.y + bodySize * 0.3, bodySize * 0.08, bodySize * 0.08);
        
        this.ctx.restore();
    }

    // —— 音效：延迟创建上下文 ——
    ensureAudioContext() {
        if (!this.audioCtx) {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (Ctx) this.audioCtx = new Ctx();
        }
    }

    playJumpSound() {
        this.ensureAudioContext();
        if (!this.audioCtx) return;
        const ctx = this.audioCtx;
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(520, now);
        osc.frequency.exponentialRampToValueAtTime(340, now + 0.12);
        gain.gain.setValueAtTime(0.0, now);
        gain.gain.linearRampToValueAtTime(0.22, now + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.16);
    }

    playHitSound() {
        this.ensureAudioContext();
        if (!this.audioCtx) return;
        const ctx = this.audioCtx;
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(320, now);
        osc.frequency.exponentialRampToValueAtTime(120, now + 0.22);
        gain.gain.setValueAtTime(0.0, now);
        gain.gain.linearRampToValueAtTime(0.3, now + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.3);
    }

    triggerGameOver() {
        if (!this.gameOver) {
            this.gameOver = true;
            if (!this.hitSoundPlayed) {
                this.playHitSound();
                this.hitSoundPlayed = true;
            }
        }
    }
    
    drawPipes() {
        this.ctx.save();
        this.ctx.fillStyle = '#2ECC71';
        
        this.pipes.forEach(pipe => {
            // 上管道
            this.ctx.fillRect(pipe.x, 0, this.pipeWidth, pipe.gapY);
            
            // 下管道
            this.ctx.fillRect(pipe.x, pipe.gapY + this.pipeGap, this.pipeWidth, this.canvas.height - pipe.gapY - this.pipeGap);
            
            // 管道边缘装饰
            this.ctx.fillStyle = '#27AE60';
            this.ctx.fillRect(pipe.x - 2, pipe.gapY - 10, this.pipeWidth + 4, 10);
            this.ctx.fillRect(pipe.x - 2, pipe.gapY + this.pipeGap, this.pipeWidth + 4, 10);
            this.ctx.fillStyle = '#2ECC71';
        });
        
        this.ctx.restore();
    }
    
    drawClouds() {
        this.ctx.save();
        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        
        this.clouds.forEach(cloud => {
            this.ctx.beginPath();
            this.ctx.arc(cloud.x, cloud.y, cloud.size, 0, Math.PI * 2);
            this.ctx.fill();
        });
        
        this.ctx.restore();
    }
    
    drawBackground() {
        // 天空渐变
        const gradient = this.ctx.createLinearGradient(0, 0, 0, this.canvas.height);
        gradient.addColorStop(0, '#87CEEB');
        gradient.addColorStop(1, '#98FB98');
        
        this.ctx.fillStyle = gradient;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        
        // 地面
        this.ctx.fillStyle = '#8B4513';
        this.ctx.fillRect(0, this.canvas.height - 50, this.canvas.width, 50);
        
        // 地面纹理
        this.ctx.fillStyle = '#A0522D';
        for (let i = 0; i < this.canvas.width; i += 20) {
            this.ctx.fillRect(i, this.canvas.height - 50, 10, 50);
        }
    }
    
    drawStartScreen() {
        this.drawBackground();
        this.drawClouds();
        
        this.ctx.save();
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        
        this.ctx.fillStyle = '#FFF';
        this.ctx.font = '48px Courier New';
        this.ctx.textAlign = 'center';
        this.ctx.fillText('像素小鸟', this.canvas.width / 2, this.canvas.height / 2 - 50);
        
        this.ctx.font = '24px Courier New';
        this.ctx.fillText('点击开始游戏按钮开始', this.canvas.width / 2, this.canvas.height / 2 + 20);
        
        this.ctx.restore();
    }
    
    drawGameOver() {
        this.ctx.save();
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        
        
        this.ctx.restore();
    }
    
    render() {
        // 清空画布
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        if (!this.gameRunning) {
            this.drawStartScreen();
            return;
        }
        
        // 绘制游戏元素
        this.drawBackground();
        this.drawClouds();
        if (this.mode === 'single') {
            this.drawPipes();
            this.drawBird();
            this.drawScoreHUD();
        } else {
            this.drawMultiplayerWorld();
        }
        
        if (this.gameOver) {
            this.drawGameOver();
            this.showGameOverScreen();
        }
    }

    // —— 模式管理 ——
    setMode(mode) {
        this.mode = mode;
        this.isMultiplayer = mode === 'multi';
        if (this.singleBtn && this.multiBtn) {
            this.singleBtn.classList.toggle('active', mode === 'single');
            this.multiBtn.classList.toggle('active', mode === 'multi');
        }
    }

    startMultiplayer() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.showWaiting(true, '已连接，等待对手...');
            return;
        }
        try {
            // 连接同源服务器的 WebSocket
            const loc = window.location;
            const wsUrl = (loc.protocol === 'https:' ? 'wss://' : 'ws://') + loc.host;
            this.ws = new WebSocket(wsUrl);
        } catch (e) {
            alert('无法连接服务器');
            return;
        }
        this.attachWsHandlers();
        this.showWaiting(true, '匹配对手中...');
        // 等待连接 OPEN 再发送昵称与颜色，避免丢包
        const trySendMeta = () => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.sendNameIfAny();
                this.sendColorIfAny();
            } else {
                setTimeout(trySendMeta, 200);
            }
        };
        trySendMeta();
    }

    attachWsHandlers() {
        if (!this.ws) return;
        this.ws.onmessage = (ev) => {
            let msg; try { msg = JSON.parse(ev.data); } catch { return; }
            if (msg.type === 'joined') {
                this.playerId = msg.id;
            }
            if (msg.type === 'room_ready') {
                if (this.readyStartBtn) this.readyStartBtn.disabled = false;
                if (this.waitingText) this.waitingText.textContent = '双方进入房间，请双方点击准备';
                if (this.readyStartBtn) this.readyStartBtn.textContent = '准备';
            }
            if (msg.type === 'lobby_name_update') {
                // 可用于在等待层显示对手昵称，当前只确保本地保留输入
            }
            if (msg.type === 'lobby_color_update') {
                // 同上，可扩展为等待界面显示双方颜色
            }
            if (msg.type === 'player_ready') {
                // 可根据需要展示哪个玩家已准备
                if (this.waitingText) this.waitingText.textContent = '有人已准备，等待双方都准备...';
            }
            if (msg.type === 'countdown') {
                this.showCountdown(msg.value);
            }
            if (msg.type === 'start') {
                this.serverState = null;
            }
            if (msg.type === 'state') {
                // 接收 authoritative 状态，进入渲染模式
                this.serverState = msg.state;
                if (!this.gameRunning) {
                    this.gameRunning = true;
                    this.gameOver = false;
                    this.hideWaiting();
                }
                // 在多人模式下，不本地推进逻辑；仅靠服务端帧
                this.render();
            }
            if (msg.type === 'game_over') {
                this.gameRunning = false;
                this.gameOver = true;
                const winnerName = msg.winnerName || '平局';
                this.score = msg.score ?? this.score;
                this.finalScoreElement.textContent = `${winnerName} 赢得了比赛 (分数: ${this.score})`;
                this.gameOverDiv.style.display = 'block';
            }
        };
        this.ws.onclose = () => {
            this.ws = null;
            this.playerId = null;
            this.serverState = null;
            this.showWaiting(false);
        };
    }

    sendReady() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            // 确保使用最新昵称与颜色
            this.sendNameIfAny();
            this.sendColorIfAny();
            this.ws.send(JSON.stringify({ type: 'ready' }));
            if (this.readyStartBtn) {
                this.readyStartBtn.disabled = true;
                this.readyStartBtn.textContent = '已准备，等待对手';
            }
        }
    }

    sendNameIfAny() {
        if (!this.playerNameInput) return;
        const name = (this.playerNameInput.value || '').trim();
        if (!name) return;
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'set_name', name }));
        }
    }

    sendColorIfAny() {
        if (!this.playerColorInput) return;
        const color = (this.playerColorInput.value || '').trim();
        if (!color) return;
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'set_color', color }));
        }
    }

    showWaiting(show, text) {
        if (!this.waitingOverlay) return;
        this.waitingOverlay.style.display = show ? 'block' : 'none';
        if (text && this.waitingText) this.waitingText.textContent = text;
        if (this.countdownEl) this.countdownEl.style.display = 'none';
        if (this.readyStartBtn) this.readyStartBtn.disabled = true;
    }

    hideWaiting() {
        if (this.waitingOverlay) this.waitingOverlay.style.display = 'none';
    }

    returnToReadyLobby() {
        // 清理对局状态，回到等待层
        this.gameRunning = false;
        this.gameOver = false;
        this.gameOverDiv.style.display = 'none';
        // 先显示等待层，再手动恢复按钮状态，避免 showWaiting 覆盖
        this.showWaiting(true);
        if (this.readyStartBtn) {
            this.readyStartBtn.disabled = false;
            this.readyStartBtn.textContent = '准备';
        }
        if (this.waitingText) this.waitingText.textContent = '双方进入房间，请双方点击准备';
        // 通知服务器本客户端准备状态需要重新确认（不自动 ready）
    }

    showCountdown(value) {
        if (!this.countdownEl) return;
        this.countdownEl.style.display = 'block';
        this.countdownEl.textContent = String(value);
    }

    drawMultiplayerWorld() {
        // 使用服务端状态渲染
        const s = this.serverState;
        if (!s) return;
        // 管道
        this.ctx.save();
        this.ctx.fillStyle = '#2ECC71';
        s.pipes.forEach(pipe => {
            this.ctx.fillRect(pipe.x, 0, this.pipeWidth, pipe.gapY);
            this.ctx.fillRect(pipe.x, pipe.gapY + this.pipeGap, this.pipeWidth, this.canvas.height - pipe.gapY - this.pipeGap);
            this.ctx.fillStyle = '#27AE60';
            this.ctx.fillRect(pipe.x - 2, pipe.gapY - 10, this.pipeWidth + 4, 10);
            this.ctx.fillRect(pipe.x - 2, pipe.gapY + this.pipeGap, this.pipeWidth + 4, 10);
            this.ctx.fillStyle = '#2ECC71';
        });
        this.ctx.restore();

        // 两只小鸟（根据服务端位置）
        const oldY = this.bird.y; // 复用 drawBird 逻辑，通过设置 this.bird.y/x
        const oldX = this.bird.x;
        const oldSize = this.bird.size;
        this.bird.size = 24;
        s.birds.forEach((b, idx) => {
            this.bird.x = b.x;
            this.bird.y = b.y;
            const color = (s.colors && s.colors[idx]) ? s.colors[idx] : (idx === 0 ? '#FFD700' : '#1ABC9C');
            const originalFill = this.ctx.fillStyle;
            this.drawBirdWithColor(color);
            this.ctx.fillStyle = originalFill;
        });
        this.bird.x = oldX; this.bird.y = oldY; this.bird.size = oldSize;

        // 画分数
        this.score = s.score;
        this.drawScoreHUD();

        // 绘制昵称（像素字体风格）
        this.ctx.save();
        this.ctx.font = '14px Courier New';
        this.ctx.textAlign = 'center';
        this.ctx.fillStyle = '#ffffff';
        s.birds.forEach((b, idx) => {
            const name = (s.names && s.names[idx]) ? s.names[idx] : (idx === 0 ? '用户1' : '用户2');
            this.ctx.fillText(name, b.x + this.bird.size / 2, b.y + this.bird.size + 16);
        });
        this.ctx.restore();
    }

    drawBirdWithColor(bodyColor) {
        this.ctx.save();
        const bodySize = this.bird.size;
        this.ctx.fillStyle = bodyColor;
        this.ctx.fillRect(this.bird.x, this.bird.y, bodySize, bodySize);
        const wingX = this.bird.x + bodySize * 0.12;
        const wingY = this.bird.y + bodySize * 0.38;
        const wingW = bodySize * 0.52;
        const wingH = bodySize * 0.34;
        this.ctx.fillStyle = '#FFA500';
        this.ctx.fillRect(wingX, wingY, wingW, wingH);
        this.ctx.strokeStyle = '#CC6E00';
        this.ctx.lineWidth = Math.max(1, bodySize * 0.06);
        this.ctx.strokeRect(wingX + 0.5, wingY + 0.5, wingW - 1, wingH - 1);
        this.ctx.fillStyle = '#FF6B35';
        this.ctx.fillRect(this.bird.x + bodySize * 0.75, this.bird.y + bodySize * 0.4, bodySize * 0.3, bodySize * 0.2);
        this.ctx.fillStyle = '#FFFFFF';
        this.ctx.fillRect(this.bird.x + bodySize * 0.55, this.bird.y + bodySize * 0.25, bodySize * 0.2, bodySize * 0.2);
        this.ctx.fillStyle = '#000000';
        this.ctx.fillRect(this.bird.x + bodySize * 0.6, this.bird.y + bodySize * 0.3, bodySize * 0.08, bodySize * 0.08);
        this.ctx.restore();
    }

    drawScoreHUD() {
        this.ctx.save();
        const text = `score: ${this.score}`;
        this.ctx.font = '28px Courier New';
        this.ctx.textAlign = 'left';
        this.ctx.textBaseline = 'top';

        // 阴影描边增强可读性
        this.ctx.fillStyle = 'rgba(0,0,0,0.5)';
        this.ctx.fillText(text, 21, 21);
        this.ctx.fillText(text, 19, 19);

        // 主体文字
        this.ctx.fillStyle = '#FFFFFF';
        this.ctx.fillText(text, 20, 20);
        this.ctx.restore();
    }
    
    showGameOverScreen() {
        this.gameRunning = false;
        this.finalScoreElement.textContent = this.score;
        this.gameOverDiv.style.display = 'block';
        this.restartBtn.style.visibility = 'hidden';
    }
    
    gameLoop() {
        if (!this.gameRunning) return;
        
        this.updateBird();
        this.updatePipes();
        this.updateClouds();
        this.render();
        
        if (!this.gameOver) {
            requestAnimationFrame(() => this.gameLoop());
        }
    }
}

// 当页面加载完成后初始化游戏
document.addEventListener('DOMContentLoaded', () => {
    new PixelBirdGame();
});
