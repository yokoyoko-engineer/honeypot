const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// ─── ゲーム状態 ───────────────────────────────────────────
let gameState = {
  phase: 'IDLE', // IDLE | BRUTE_FORCE | LOGGED_IN | DB_STOLEN | BACKDOOR_CREATED
  attackerSocketId: null,
  blockedSocketIds: new Set(),
  foundCredentials: null,   // { username, password }
  dbStolen: false,
  backdoorActive: false,
  backdoorPid: Math.floor(Math.random() * 9000) + 1000,
  attackerIp: '203.0.113.42', // シミュレート用攻撃者IP (RFC5737 テスト用IP)
};

// ─── ダミーDBデータ ─────────────────────────────────────────
const DUMMY_DB = {
  users: [
    { id: 1, username: 'admin', password_hash: '$2b$12$xK8LnW...', email: 'admin@company.local', role: 'administrator' },
    { id: 2, username: 'tanaka', password_hash: '$2b$12$mP3qRt...', email: 'tanaka@company.local', role: 'developer' },
    { id: 3, username: 'yamamoto', password_hash: '$2b$12$vL9sXu...', email: 'yamamoto@company.local', role: 'developer' },
    { id: 4, username: 'sato', password_hash: '$2b$12$nQ4rSv...', email: 'sato@company.local', role: 'hr' },
  ],
  secrets: [
    { key: 'API_KEY', value: 'sk-prod-aG9uZXlwb3QK' },
    { key: 'DB_PASSWORD', value: 'Pr0d_DB_P@ssw0rd!' },
    { key: 'SMTP_PASS', value: 'smtp_s3cr3t_2024' },
  ]
};

// ─── ダミーアクセスログ（攻撃前に偽装されたノイズも含む）───────
function generateAuthLogs(includeAttack = false) {
  const normal = [
    'Mar  1 08:12:04 server sshd[1234]: Accepted publickey for deploy from 10.0.0.5 port 52341 ssh2',
    'Mar  1 09:05:11 server sshd[1235]: Accepted password for tanaka from 192.168.10.20 port 48821 ssh2',
    'Mar  1 10:33:45 server sshd[1236]: Accepted password for yamamoto from 192.168.10.25 port 44412 ssh2',
    'Mar  1 11:00:00 server sshd[1237]: Invalid user test from 10.5.5.5 port 39201',
    'Mar  1 11:00:01 server sshd[1237]: Failed password for invalid user test from 10.5.5.5 port 39201 ssh2',
  ];
  const attack = [
    `Mar  1 11:45:01 server sshd[2001]: Failed password for root from ${gameState.attackerIp} port 51234 ssh2`,
    `Mar  1 11:45:02 server sshd[2002]: Failed password for root from ${gameState.attackerIp} port 51235 ssh2`,
    `Mar  1 11:45:03 server sshd[2003]: Failed password for admin from ${gameState.attackerIp} port 51236 ssh2`,
    `Mar  1 11:45:04 server sshd[2004]: Failed password for admin from ${gameState.attackerIp} port 51237 ssh2`,
    `Mar  1 11:45:05 server sshd[2005]: Failed password for tanaka from ${gameState.attackerIp} port 51238 ssh2`,
    `Mar  1 11:45:06 server sshd[2006]: Failed password for tanaka from ${gameState.attackerIp} port 51239 ssh2`,
    `Mar  1 11:45:07 server sshd[2007]: Accepted password for admin from ${gameState.attackerIp} port 51240 ssh2`,
    `Mar  1 11:45:08 server sshd[2007]: pam_unix(sshd:session): session opened for user admin by (uid=0)`,
  ];
  return includeAttack ? [...normal, ...attack] : normal;
}

function generateNetstatOutput() {
  return [
    'Active Internet connections (servers and established)',
    'Proto Recv-Q Send-Q Local Address           Foreign Address         State       PID/Program name',
    `tcp        0      0 0.0.0.0:22              0.0.0.0:*               LISTEN      987/sshd`,
    `tcp        0      0 0.0.0.0:3306            0.0.0.0:*               LISTEN      1023/mysqld`,
    `tcp        0    208 192.168.1.100:22         ${gameState.attackerIp}:51240  ESTABLISHED 2007/sshd`,
    ...(gameState.backdoorActive ? [
      `tcp        0      0 0.0.0.0:4444            0.0.0.0:*               LISTEN      ${gameState.backdoorPid}/nc`,
      `tcp        0      0 192.168.1.100:4444      ${gameState.attackerIp}:53892  ESTABLISHED ${gameState.backdoorPid}/nc`,
    ] : []),
    `tcp        0      0 127.0.0.1:3306          127.0.0.1:51001         ESTABLISHED 1023/mysqld`,
    `tcp6       0      0 :::80                   :::*                    LISTEN      456/nginx`,
  ].join('\n');
}

// ─── 全体状態をリセット ────────────────────────────────────────
function resetGame() {
  gameState = {
    phase: 'IDLE',
    attackerSocketId: null,
    blockedSocketIds: new Set(),
    foundCredentials: null,
    dbStolen: false,
    backdoorActive: false,
    backdoorPid: Math.floor(Math.random() * 9000) + 1000,
    attackerIp: '203.0.113.42',
  };
}

// ─── HTTP エンドポイント ──────────────────────────────────────
app.get('/', (req, res) => res.send('Security Sandbox API is running'));
app.get('/state', (req, res) => res.json({
  phase: gameState.phase,
  dbStolen: gameState.dbStolen,
  backdoorActive: gameState.backdoorActive
}));

// ─── Socket.IO ────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[+] Connected: ${socket.id}`);

  // ゲーム状態を送る（接続時）
  socket.emit('game_state', {
    phase: gameState.phase,
    dbStolen: gameState.dbStolen,
    backdoorActive: gameState.backdoorActive,
    attackerIp: gameState.attackerIp,
  });

  // ─── 攻撃側: ブルートフォース開始 ─────────────────────────
  socket.on('start_bruteforce', () => {
    if (gameState.blockedSocketIds.has(socket.id)) {
      socket.emit('blocked'); return;
    }
    gameState.phase = 'BRUTE_FORCE';
    gameState.attackerSocketId = socket.id;
    console.log(`[ATTACK] Bruteforce started by ${socket.id}`);

    // Defenderに検知アラートを送る（少し遅延させてリアルっぽく）
    setTimeout(() => {
      io.emit('bruteforce_detected', {
        ip: gameState.attackerIp,
        timestamp: new Date().toISOString(),
        message: '多数の認証失敗を検出: SSHブルートフォース攻撃の疑い',
      });
    }, 3000);

    // ブルートフォース成功をAttackerに返す（6秒後）
    setTimeout(() => {
      if (gameState.blockedSocketIds.has(socket.id)) {
        socket.emit('blocked'); return;
      }
      const creds = { username: 'admin', password: 'admin@2024' };
      gameState.foundCredentials = creds;
      socket.emit('bruteforce_success', {
        credentials: creds,
        attempts: 157,
      });
    }, 6000);
  });

  // ─── 攻撃側: 自動ログイン ──────────────────────────────────
  socket.on('auto_login', () => {
    if (gameState.blockedSocketIds.has(socket.id) || !gameState.foundCredentials) {
      socket.emit('blocked'); return;
    }
    gameState.phase = 'LOGGED_IN';
    console.log(`[ATTACK] Auto-login by ${socket.id}`);

    setTimeout(() => {
      if (gameState.blockedSocketIds.has(socket.id)) {
        socket.emit('blocked'); return;
      }
      socket.emit('login_success', {
        username: gameState.foundCredentials.username,
        server: '192.168.1.100',
        kernel: 'Linux server 5.15.0-91-generic #101-Ubuntu',
        uptime: '47 days, 3:22',
      });
    }, 2000);
  });

  // ─── 攻撃側: DB奪取 ───────────────────────────────────────
  socket.on('steal_db', () => {
    if (gameState.blockedSocketIds.has(socket.id) || gameState.phase !== 'LOGGED_IN') {
      socket.emit('blocked'); return;
    }
    gameState.phase = 'DB_STOLEN';
    gameState.dbStolen = true;
    console.log(`[ATTACK] DB stolen by ${socket.id}`);

    setTimeout(() => {
      if (gameState.blockedSocketIds.has(socket.id)) {
        socket.emit('blocked'); return;
      }
      socket.emit('db_stolen', { data: DUMMY_DB });
    }, 2500);
  });

  // ─── 攻撃側: バックドア作成 ───────────────────────────────
  socket.on('create_backdoor', () => {
    if (gameState.blockedSocketIds.has(socket.id) || gameState.phase !== 'DB_STOLEN') {
      socket.emit('blocked'); return;
    }
    gameState.backdoorActive = true;
    console.log(`[ATTACK] Backdoor created by ${socket.id}, PID: ${gameState.backdoorPid}`);

    setTimeout(() => {
      socket.emit('backdoor_created', {
        pid: gameState.backdoorPid,
        port: 4444,
        script: '/tmp/.hidden/bd.sh',
      });
      gameState.phase = 'BACKDOOR_CREATED';
    }, 1500);
  });

  // ─── 防御側: ログ取得 ──────────────────────────────────────
  socket.on('get_logs', () => {
    const includeAttack = gameState.phase !== 'IDLE';
    socket.emit('logs_data', {
      authlog: generateAuthLogs(includeAttack),
      attackerIp: gameState.attackerIp,
    });
  });

  // ─── 防御側: netstat取得 ───────────────────────────────────
  socket.on('get_netstat', () => {
    socket.emit('netstat_data', { output: generateNetstatOutput() });
  });

  // ─── 防御側: IPブロック ────────────────────────────────────
  socket.on('block_attacker', ({ ip }) => {
    if (ip !== gameState.attackerIp) {
      socket.emit('block_result', { success: false, message: `${ip}: ホストへのルートがありません` });
      return;
    }
    console.log(`[DEFENSE] Blocking IP: ${ip}`);

    // 攻撃者のSocketをブロック
    if (gameState.attackerSocketId) {
      gameState.blockedSocketIds.add(gameState.attackerSocketId);
      // Attackerをログアウトさせる
      io.to(gameState.attackerSocketId).emit('force_logout', {
        reason: 'Connection closed by remote host.',
      });
    }

    socket.emit('block_result', {
      success: true,
      message: `iptables: ルールを追加: -s ${ip} -j DROP`,
    });

    // バックドアが生きているかを通知
    if (gameState.backdoorActive) {
      setTimeout(() => {
        socket.emit('backdoor_still_active', {
          pid: gameState.backdoorPid,
          port: 4444,
          message: 'バックドア接続は依然としてアクティブです。完全な遮断には追加対応が必要です。',
        });
      }, 2000);
    }
  });

  // ─── 防御側: 被害調査 ──────────────────────────────────────
  socket.on('investigate_damage', () => {
    const candidates = [
      { id: 'a', path: '/var/log/nginx/access.log', description: 'Webサーバーのアクセスログ（サイズ: 2.3MB）', isCorrect: false },
      { id: 'b', path: '/var/lib/mysql/company_db/', description: 'MySQLデータベースファイル（最終変更: 11:45:08）', isCorrect: true },
      { id: 'c', path: '/etc/passwd', description: 'システムユーザーファイル（変更なし）', isCorrect: false },
      { id: 'd', path: '/var/www/html/', description: 'Webコンテンツディレクトリ（変更なし）', isCorrect: false },
    ];

    socket.emit('damage_report', {
      candidates,
      dbStolen: gameState.dbStolen,
      backdoorActive: gameState.backdoorActive,
      backdoorPid: gameState.backdoorPid,
    });
  });

  // ─── 防御側: バックドア遮断 ───────────────────────────────
  socket.on('remove_backdoor', ({ method, value }) => {
    // kill <PID> または rm /tmp/.hidden/bd.sh が正解
    const validPid = method === 'kill' && parseInt(value) === gameState.backdoorPid;
    const validRm = method === 'rm' && value.includes('/tmp/.hidden');

    if (validPid || validRm) {
      gameState.backdoorActive = false;
      console.log(`[DEFENSE] Backdoor removed via ${method}`);
      socket.emit('backdoor_removed', { success: true, method, value });
      io.emit('game_clear', {
        message: 'インシデント対応完了。バックドアを遮断し、被害を食い止めました。',
      });
    } else {
      socket.emit('backdoor_removed', { success: false, message: `${value}: コマンドが正しくありません` });
    }
  });

  // ─── ゲームリセット ────────────────────────────────────────
  socket.on('reset_game', () => {
    resetGame();
    io.emit('game_reset');
    console.log('[SYSTEM] Game reset');
  });

  socket.on('disconnect', () => {
    console.log(`[-] Disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
