const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const pty = require('node-pty');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// ─── ゲーム状態の管理 ─────────────────────────────────────────
const rooms = {};

function getRoom(roomId) {
  if (!rooms[roomId]) {
    rooms[roomId] = {
      id: roomId,
      phase: 'WAITING', // WAITING | IDLE | BRUTE_FORCE | LOGGED_IN | DB_STOLEN | BACKDOOR_CREATED
      attackerSocketId: null,
      defenderSocketId: null,
      blockedSocketIds: new Set(),
      foundCredentials: null,
      dbStolen: false,
      backdoorActive: false,
      backdoorPid: Math.floor(Math.random() * 9000) + 1000,
      attackerIp: '203.0.113.' + (Math.floor(Math.random() * 200) + 10), // ランダム生成
      ptyProcess: null,
    };
  }
  return rooms[roomId];
}

function broadcastRoomsStatus() {
  const status = Object.keys(rooms).map(id => {
    const r = rooms[id];
    return {
      id,
      hasAttacker: !!r.attackerSocketId,
      hasDefender: !!r.defenderSocketId,
      phase: r.phase
    };
  });
  // 常時ルームリストとして 1~3は存在しているように見せる
  ['ROOM1', 'ROOM2', 'ROOM3'].forEach(r => {
    if (!status.find(s => s.id === r)) status.push({ id: r, hasAttacker: false, hasDefender: false, phase: 'WAITING' });
  });
  io.emit('rooms_status', status);
}

function checkMatchStart(roomId) {
  const r = rooms[roomId];
  if (r.attackerSocketId && r.defenderSocketId && r.phase === 'WAITING') {
    r.phase = 'IDLE';
    io.to(roomId).emit('match_started', { message: '対戦相手が見つかりました。ゲームを開始します。' });
    io.to(roomId).emit('game_state', getPublicState(r));
    broadcastRoomsStatus();
  }
}

function getPublicState(r) {
  return {
    phase: r.phase,
    dbStolen: r.dbStolen,
    backdoorActive: r.backdoorActive,
    attackerIp: r.attackerIp,
  };
}

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
function generateAuthLogs(room, includeAttack = false) {
  const normal = [
    'Mar  1 08:12:04 server sshd[1234]: Accepted publickey for deploy from 10.0.0.5 port 52341 ssh2',
    'Mar  1 09:05:11 server sshd[1235]: Accepted password for tanaka from 192.168.10.20 port 48821 ssh2',
    'Mar  1 10:33:45 server sshd[1236]: Accepted password for yamamoto from 192.168.10.25 port 44412 ssh2',
    'Mar  1 11:00:00 server sshd[1237]: Invalid user test from 10.5.5.5 port 39201',
    'Mar  1 11:00:01 server sshd[1237]: Failed password for invalid user test from 10.5.5.5 port 39201 ssh2',
  ];
  const attack = [
    `Mar  1 11:45:01 server sshd[2001]: Failed password for root from ${room.attackerIp} port 51234 ssh2`,
    `Mar  1 11:45:02 server sshd[2002]: Failed password for root from ${room.attackerIp} port 51235 ssh2`,
    `Mar  1 11:45:03 server sshd[2003]: Failed password for admin from ${room.attackerIp} port 51236 ssh2`,
    `Mar  1 11:45:04 server sshd[2004]: Failed password for admin from ${room.attackerIp} port 51237 ssh2`,
    `Mar  1 11:45:05 server sshd[2005]: Failed password for tanaka from ${room.attackerIp} port 51238 ssh2`,
    `Mar  1 11:45:06 server sshd[2006]: Failed password for tanaka from ${room.attackerIp} port 51239 ssh2`,
    `Mar  1 11:45:07 server sshd[2007]: Accepted password for admin from ${room.attackerIp} port 51240 ssh2`,
    `Mar  1 11:45:08 server sshd[2007]: pam_unix(sshd:session): session opened for user admin by (uid=0)`,
  ];
  return includeAttack ? [...normal, ...attack] : normal;
}

function generateNetstatOutput(room) {
  return [
    'Active Internet connections (servers and established)',
    'Proto Recv-Q Send-Q Local Address           Foreign Address         State       PID/Program name',
    `tcp        0      0 0.0.0.0:22              0.0.0.0:*               LISTEN      987/sshd`,
    `tcp        0      0 0.0.0.0:3306            0.0.0.0:*               LISTEN      1023/mysqld`,
    `tcp        0    208 192.168.1.100:22         ${room.attackerIp}:51240  ESTABLISHED 2007/sshd`,
    ...(room.backdoorActive ? [
      `tcp        0      0 0.0.0.0:4444            0.0.0.0:*               LISTEN      ${room.backdoorPid}/nc`,
      `tcp        0      0 192.168.1.100:4444      ${room.attackerIp}:53892  ESTABLISHED ${room.backdoorPid}/nc`,
    ] : []),
    `tcp        0      0 127.0.0.1:3306          127.0.0.1:51001         ESTABLISHED 1023/mysqld`,
    `tcp6       0      0 :::80                   :::*                    LISTEN      456/nginx`,
  ].join('\n');
}

// ─── 全体状態をリセット ────────────────────────────────────────
function resetRoom(roomId) {
  if (rooms[roomId]) {
    rooms[roomId].phase = 'WAITING';
    rooms[roomId].blockedSocketIds = new Set();
    rooms[roomId].foundCredentials = null;
    rooms[roomId].dbStolen = false;
    rooms[roomId].backdoorActive = false;
    rooms[roomId].attackerSocketId = null;
    rooms[roomId].defenderSocketId = null;
    rooms[roomId].backdoorPid = Math.floor(Math.random() * 9000) + 1000;
  }
}

// ─── PTY 初期化 ──────────────────────────────────────────────
function initPty(roomId) {
  const r = getRoom(roomId);
  if (r.ptyProcess) return;

  const rcFile = `/tmp/.bashrc_${roomId}`;
  const bashrcContent = `
export PS1="defender@server:~$ "
alias help="echo 'Available commands: iptables, kill, rm, investigate, tail, netstat, ps, etc.'"
iptables() {
  if [[ "$1" == "-A" && "$2" == "INPUT" && "$3" == "-s" && "$5" == "-j" && "$6" == "DROP" ]]; then
    curl -s -X POST http://127.0.0.1:3000/internal/block -H "Content-Type: application/json" -d "{\\"roomId\\":\\"${roomId}\\", \\"ip\\":\\"$4\\"}" > /dev/null
  else
    echo "iptables v1.8.7"
  fi
}
investigate() {
  curl -s -X POST http://127.0.0.1:3000/internal/investigate -H "Content-Type: application/json" -d "{\\"roomId\\":\\"${roomId}\\"}" > /dev/null
}
kill() {
  if [[ "$1" == "-9" ]]; then
    PID=$2
  else
    PID=$1
  fi
  curl -s -X POST http://127.0.0.1:3000/internal/kill -H "Content-Type: application/json" -d "{\\"roomId\\":\\"${roomId}\\", \\"pid\\":\\"$PID\\"}" > /dev/null
}
rm() {
  if [[ "$*" == *"/tmp/.hidden"* ]]; then
    curl -s -X POST http://127.0.0.1:3000/internal/rm -H "Content-Type: application/json" -d "{\\"roomId\\":\\"${roomId}\\", \\"path\\":\\"rm $*\\"}" > /dev/null
  fi
  /bin/rm "$@"
}
tail() {
  if [[ "$*" == *"/var/log/auth.log"* ]]; then
    curl -s http://127.0.0.1:3000/internal/logs?roomId=${roomId}
  else
    /usr/bin/tail "$@"
  fi
}
netstat() {
  if [[ "$*" == *"-an"* ]]; then
    curl -s http://127.0.0.1:3000/internal/netstat?roomId=${roomId}
  else
    /bin/netstat "$@"
  fi
}
ps() {
  if [[ "$*" == *"aux"* ]]; then
    curl -s http://127.0.0.1:3000/internal/ps?roomId=${roomId}
  else
    /bin/ps "$@"
  fi
}
`;
  fs.writeFileSync(rcFile, bashrcContent);

  r.ptyProcess = pty.spawn('bash', ['--rcfile', rcFile, '-i'], {
    name: 'xterm-color',
    cols: 80,
    rows: 24,
    cwd: '/root',
    env: process.env
  });

  r.ptyProcess.onData((data) => {
    io.to(roomId).emit('pty_output', { output: data });
  });
}

// ─── HTTP エンドポイント ──────────────────────────────────────
app.get('/', (req, res) => res.send('Security Sandbox API is running'));
app.get('/rooms', (req, res) => {
  broadcastRoomsStatus();
  res.json({ success: true });
});

app.post('/internal/block', (req, res) => {
  const { roomId, ip } = req.body;
  const r = getRoom(roomId);
  if (!r) return res.json({ success: false });

  if (ip !== r.attackerIp) {
    if (r.ptyProcess) r.ptyProcess.write(`\niptables: ルールを追加: -s ${ip} -j DROP\ndefender@server:~$ `);
    io.to(r.id).emit('block_result', { success: false, message: `${ip}: ホストへのルートがありません` });
    return res.json({ success: false });
  }

  if (r.attackerSocketId) {
    r.blockedSocketIds.add(r.attackerSocketId);
    io.to(r.attackerSocketId).emit('force_logout', { reason: 'Connection closed by remote host.' });
  }

  if (r.ptyProcess) r.ptyProcess.write(`\niptables: ルールを追加: -s ${ip} -j DROP\ndefender@server:~$ `);

  io.to(r.id).emit('block_result', {
    success: true,
    message: `iptables: ルールを追加: -s ${ip} -j DROP`,
  });

  if (r.backdoorActive) {
    setTimeout(() => {
      io.to(r.id).emit('backdoor_still_active', {
        pid: r.backdoorPid,
        port: 4444,
        message: 'バックドア接続は依然としてアクティブです。完全な遮断には追加対応が必要です。',
      });
    }, 2000);
  }
  res.json({ success: true });
});

app.post('/internal/investigate', (req, res) => {
  const { roomId } = req.body;
  const r = getRoom(roomId);
  if (!r) return res.json({ success: false });

  const candidates = [
    { id: 'a', path: '/var/log/nginx/access.log', description: 'Webサーバーのアクセスログ（サイズ: 2.3MB）', isCorrect: false },
    { id: 'b', path: '/var/lib/mysql/company_db/', description: 'MySQLデータベースファイル（最終変更: 11:45:08）', isCorrect: true },
    { id: 'c', path: '/etc/passwd', description: 'システムユーザーファイル（変更なし）', isCorrect: false },
    { id: 'd', path: '/var/www/html/', description: 'Webコンテンツディレクトリ（変更なし）', isCorrect: false },
  ];

  if (r.ptyProcess) r.ptyProcess.write(`\n被害調査を開始します...\ndefender@server:~$ `);
  io.to(r.id).emit('damage_report', {
    candidates, dbStolen: r.dbStolen, backdoorActive: r.backdoorActive, backdoorPid: r.backdoorPid,
  });
  res.json({ success: true });
});

app.post('/internal/kill', (req, res) => {
  const { roomId, pid } = req.body;
  const r = getRoom(roomId);
  if (!r) return res.json({ success: false });

  if (parseInt(pid) === r.backdoorPid) {
    r.backdoorActive = false;
    if (r.ptyProcess) r.ptyProcess.write(`\nTerminated PID ${pid}\ndefender@server:~$ `);
    io.to(r.id).emit('backdoor_removed', { success: true, method: 'kill', value: pid });
    io.to(r.id).emit('game_clear', { message: 'インシデント対応完了。バックドアを遮断し、被害を食い止めました。' });
    io.to(r.id).emit('game_state', getPublicState(r));
  } else {
    if (r.ptyProcess) r.ptyProcess.write(`\nkill: cannot find process "${pid}"\ndefender@server:~$ `);
    io.to(r.id).emit('backdoor_removed', { success: false, message: `${pid}: コマンドが正しくありません` });
  }
  res.json({ success: true });
});

app.post('/internal/rm', (req, res) => {
  const { roomId, path } = req.body;
  const r = getRoom(roomId);
  if (!r) return res.json({ success: false });

  if (path.includes('/tmp/.hidden')) {
    r.backdoorActive = false;
    if (r.ptyProcess) r.ptyProcess.write(`\ndefender@server:~$ `);
    io.to(r.id).emit('backdoor_removed', { success: true, method: 'rm', value: path });
    io.to(r.id).emit('game_clear', { message: 'インシデント対応完了。バックドアを遮断し、被害を食い止めました。' });
    io.to(r.id).emit('game_state', getPublicState(r));
  } else {
    io.to(r.id).emit('backdoor_removed', { success: false, message: `${path}: コマンドが正しくありません` });
  }
  res.json({ success: true });
});

app.get('/internal/logs', (req, res) => {
  const r = getRoom(req.query.roomId);
  if (!r) return res.send('');
  const includeAttack = r.phase !== 'WAITING' && r.phase !== 'IDLE';
  const logs = generateAuthLogs(r, includeAttack);
  res.send(logs.join('\\n') + '\\n');
});

app.get('/internal/netstat', (req, res) => {
  const r = getRoom(req.query.roomId);
  if (!r) return res.send('');
  res.send(generateNetstatOutput(r) + '\\n');
});

app.get('/internal/ps', (req, res) => {
  const r = getRoom(req.query.roomId);
  if (!r) return res.send('');
  const lines = [
    `USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND`,
    `root           1  0.0  0.1 103444 10220 ?        Ss   08:00   0:01 /sbin/init`,
    `root         987  0.0  0.1  72312  5860 ?        Ss   08:00   0:00 sshd: /usr/sbin/sshd -D`,
    `root        1023  0.0  1.2 589672 51200 ?        Ssl  08:00   0:08 /usr/sbin/mysqld`,
    `root        2007  0.0  0.0  14548  3200 ?        Ss   11:45   0:00 sshd: admin [priv]`,
    ...(r.backdoorActive ? [
      `root        ${r.backdoorPid ?? 9999}  0.0  0.0   4288  1024 ?        S    11:45   0:00 /bin/bash /tmp/.hidden/bd.sh`,
      `root        ${(r.backdoorPid ?? 9999) + 1}  0.0  0.0   2444   904 ?        S    11:45   0:00 nc -lnvp 4444 -e /bin/bash`,
    ] : []),
  ];
  res.send(lines.join('\\n') + '\\n');
});

// ─── Socket.IO ────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[+] Connected: ${socket.id}`);

  socket.on('get_rooms', () => {
    broadcastRoomsStatus();
  });

  socket.on('pty_input', ({ input }) => {
    const r = getRoom(socket.roomId);
    if (r && r.ptyProcess) r.ptyProcess.write(input);
  });

  socket.on('pty_resize', ({ cols, rows }) => {
    const r = getRoom(socket.roomId);
    if (r && r.ptyProcess) r.ptyProcess.resize(cols, rows);
  });

  socket.on('join_room', ({ roomId, role }) => {
    socket.join(roomId);
    socket.roomId = roomId; // ソケットに部屋IDを記憶させる
    socket.role = role;

    const r = getRoom(roomId);
    if (role === 'ATTACKER') r.attackerSocketId = socket.id;
    if (role === 'DEFENDER') {
      r.defenderSocketId = socket.id;
      initPty(roomId);
    }

    console.log(`[+] ${socket.id} joined ${roomId} as ${role}`);
    socket.emit('game_state', getPublicState(r));
    broadcastRoomsStatus();
    checkMatchStart(roomId);
  });

  // ─── 攻撃側: ブルートフォース開始 ─────────────────────────
  socket.on('start_bruteforce', () => {
    const r = getRoom(socket.roomId);
    if (!r || r.blockedSocketIds.has(socket.id) || r.phase !== 'IDLE') {
      socket.emit('blocked'); return;
    }
    r.phase = 'BRUTE_FORCE';
    console.log(`[ATTACK] Bruteforce started by ${socket.id} in ${r.id}`);

    // Defenderに検知アラートを送る
    setTimeout(() => {
      io.to(r.id).emit('bruteforce_detected', {
        ip: r.attackerIp,
        timestamp: new Date().toISOString(),
        message: '多数の認証失敗を検出: SSHブルートフォース攻撃の疑い',
      });
    }, 3000);

    // ブルートフォース成功をAttackerに返す
    setTimeout(() => {
      if (r.blockedSocketIds.has(socket.id)) {
        socket.emit('blocked'); return;
      }
      const creds = { username: 'admin', password: 'admin@2024' };
      r.foundCredentials = creds;
      socket.emit('bruteforce_success', {
        credentials: creds,
        attempts: 157,
      });
      io.to(r.id).emit('game_state', getPublicState(r));
      broadcastRoomsStatus();
    }, 6000);
  });

  // ─── 攻撃側: 自動ログイン ──────────────────────────────────
  socket.on('auto_login', () => {
    const r = getRoom(socket.roomId);
    if (!r || r.blockedSocketIds.has(socket.id) || !r.foundCredentials) {
      socket.emit('blocked'); return;
    }
    r.phase = 'LOGGED_IN';
    console.log(`[ATTACK] Auto-login by ${socket.id} in ${r.id}`);

    setTimeout(() => {
      if (r.blockedSocketIds.has(socket.id)) {
        socket.emit('blocked'); return;
      }
      socket.emit('login_success', {
        username: r.foundCredentials.username,
        server: '192.168.1.100',
        kernel: 'Linux server 5.15.0-91-generic #101-Ubuntu',
        uptime: '47 days, 3:22',
      });
      io.to(r.id).emit('game_state', getPublicState(r));
    }, 2000);
  });

  // ─── 攻撃側: DB奪取 ───────────────────────────────────────
  socket.on('steal_db', () => {
    const r = getRoom(socket.roomId);
    if (!r || r.blockedSocketIds.has(socket.id) || r.phase !== 'LOGGED_IN') {
      socket.emit('blocked'); return;
    }
    r.phase = 'DB_STOLEN';
    r.dbStolen = true;
    console.log(`[ATTACK] DB stolen by ${socket.id}`);

    setTimeout(() => {
      if (r.blockedSocketIds.has(socket.id)) {
        socket.emit('blocked'); return;
      }
      socket.emit('db_stolen', { data: DUMMY_DB });
      io.to(r.id).emit('game_state', getPublicState(r));
    }, 2500);
  });

  // ─── 攻撃側: バックドア作成 ───────────────────────────────
  socket.on('create_backdoor', () => {
    const r = getRoom(socket.roomId);
    if (!r || r.blockedSocketIds.has(socket.id) || r.phase !== 'DB_STOLEN') {
      socket.emit('blocked'); return;
    }
    r.backdoorActive = true;
    console.log(`[ATTACK] Backdoor created by ${socket.id}, PID: ${r.backdoorPid}`);

    setTimeout(() => {
      socket.emit('backdoor_created', {
        pid: r.backdoorPid,
        port: 4444,
        script: '/tmp/.hidden/bd.sh',
      });
      r.phase = 'BACKDOOR_CREATED';
      io.to(r.id).emit('game_state', getPublicState(r));
    }, 1500);
  });

  // ─── 防御側: ログ取得 ──────────────────────────────────────
  socket.on('get_logs', () => {
    const r = getRoom(socket.roomId);
    if (!r) return;
    const includeAttack = r.phase !== 'WAITING' && r.phase !== 'IDLE';
    socket.emit('logs_data', {
      authlog: generateAuthLogs(r, includeAttack),
      attackerIp: r.attackerIp,
    });
  });

  // ─── 防御側: netstat取得 ───────────────────────────────────
  socket.on('get_netstat', () => {
    const r = getRoom(socket.roomId);
    if (!r) return;
    socket.emit('netstat_data', { output: generateNetstatOutput(r) });
  });

  // ─── 防御側: IPブロック ────────────────────────────────────
  socket.on('block_attacker', ({ ip }) => {
    const r = getRoom(socket.roomId);
    if (!r) return;
    if (ip !== r.attackerIp) {
      socket.emit('block_result', { success: false, message: `${ip}: ホストへのルートがありません` });
      return;
    }
    console.log(`[DEFENSE] Blocking IP: ${ip} in ${r.id}`);

    // 攻撃者のSocketをブロック
    if (r.attackerSocketId) {
      r.blockedSocketIds.add(r.attackerSocketId);
      // Attackerをログアウトさせる
      io.to(r.attackerSocketId).emit('force_logout', {
        reason: 'Connection closed by remote host.',
      });
    }

    socket.emit('block_result', {
      success: true,
      message: `iptables: ルールを追加: -s ${ip} -j DROP`,
    });

    // バックドアが生きているかを通知
    if (r.backdoorActive) {
      setTimeout(() => {
        socket.emit('backdoor_still_active', {
          pid: r.backdoorPid,
          port: 4444,
          message: 'バックドア接続は依然としてアクティブです。完全な遮断には追加対応が必要です。',
        });
      }, 2000);
    }
  });

  // ─── 防御側: 被害調査 ──────────────────────────────────────
  socket.on('investigate_damage', () => {
    const r = getRoom(socket.roomId);
    if (!r) return;
    const candidates = [
      { id: 'a', path: '/var/log/nginx/access.log', description: 'Webサーバーのアクセスログ（サイズ: 2.3MB）', isCorrect: false },
      { id: 'b', path: '/var/lib/mysql/company_db/', description: 'MySQLデータベースファイル（最終変更: 11:45:08）', isCorrect: true },
      { id: 'c', path: '/etc/passwd', description: 'システムユーザーファイル（変更なし）', isCorrect: false },
      { id: 'd', path: '/var/www/html/', description: 'Webコンテンツディレクトリ（変更なし）', isCorrect: false },
    ];

    socket.emit('damage_report', {
      candidates,
      dbStolen: r.dbStolen,
      backdoorActive: r.backdoorActive,
      backdoorPid: r.backdoorPid,
    });
  });

  // ─── 防御側: バックドア遮断 ───────────────────────────────
  socket.on('remove_backdoor', ({ method, value }) => {
    const r = getRoom(socket.roomId);
    if (!r) return;
    // kill <PID> または rm /tmp/.hidden/bd.sh が正解
    const validPid = method === 'kill' && parseInt(value) === r.backdoorPid;
    const validRm = method === 'rm' && value.includes('/tmp/.hidden');

    if (validPid || validRm) {
      r.backdoorActive = false;
      console.log(`[DEFENSE] Backdoor removed via ${method} in ${r.id}`);
      socket.emit('backdoor_removed', { success: true, method, value });
      io.to(r.id).emit('game_clear', {
        message: 'インシデント対応完了。バックドアを遮断し、被害を食い止めました。',
      });
      io.to(r.id).emit('game_state', getPublicState(r));
    } else {
      socket.emit('backdoor_removed', { success: false, message: `${value}: コマンドが正しくありません` });
    }
  });

  // ─── ゲームリセット ────────────────────────────────────────
  socket.on('reset_game', () => {
    if (socket.roomId) {
      resetRoom(socket.roomId);
      io.to(socket.roomId).emit('game_reset');
      console.log(`[SYSTEM] Game reset in ${socket.roomId}`);
      broadcastRoomsStatus();
    }
  });

  socket.on('disconnect', () => {
    console.log(`[-] Disconnected: ${socket.id}`);
    if (socket.roomId) {
      const r = getRoom(socket.roomId);
      if (socket.role === 'ATTACKER') r.attackerSocketId = null;
      if (socket.role === 'DEFENDER') r.defenderSocketId = null;
      if (!r.attackerSocketId && !r.defenderSocketId) resetRoom(socket.roomId);
      broadcastRoomsStatus();
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
