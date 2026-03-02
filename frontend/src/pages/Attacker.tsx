import { useState, useEffect, useRef } from 'react';
import { Socket } from 'socket.io-client';
import { useNavigate } from 'react-router-dom';

interface AttackerProps {
    socket: Socket | null;
}

interface TerminalLine {
    id: string;
    text: string;
    type: 'cmd' | 'output' | 'success' | 'error' | 'warn' | 'system';
}

type GamePhase = 'IDLE' | 'BRUTE_FORCE' | 'LOGGED_IN' | 'DB_STOLEN' | 'BACKDOOR_CREATED' | 'BLOCKED';

function uid() { return Math.random().toString(36).slice(2, 9); }

function TermLine({ line }: { line: TerminalLine }) {
    const colors: Record<string, string> = {
        cmd: 'text-green-400',
        output: 'text-slate-300',
        success: 'text-cyan-400',
        error: 'text-red-400',
        warn: 'text-yellow-400',
        system: 'text-purple-400',
    };
    return (
        <div className={`font-mono text-sm leading-relaxed whitespace-pre-wrap ${colors[line.type]}`}>
            {line.type === 'cmd' && <span className="text-green-600 mr-1">$</span>}
            {line.text}
        </div>
    );
}

export function Attacker({ socket }: AttackerProps) {
    const navigate = useNavigate();
    const [lines, setLines] = useState<TerminalLine[]>([]);
    const [phase, setPhase] = useState<GamePhase>('IDLE');
    const [busy, setBusy] = useState(false);
    const [target] = useState('192.168.1.100');
    const bottomRef = useRef<HTMLDivElement>(null);

    const addLine = (text: string, type: TerminalLine['type'] = 'output') => {
        setLines(prev => [...prev, { id: uid(), text, type }]);
    };

    const addLines = (texts: string[], type: TerminalLine['type'] = 'output') => {
        const newLines = texts.map(text => ({ id: uid(), text, type }));
        setLines(prev => [...prev, ...newLines]);
    };

    // 自動スクロール
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [lines]);

    // Socket イベントリスナー
    useEffect(() => {
        if (!socket) return;

        socket.on('game_state', (data) => {
            setPhase(data.phase === 'BLOCKED' ? 'BLOCKED' : data.phase);
        });

        socket.on('bruteforce_success', (data) => {
            setBusy(false);
            addLines([
                ``,
                `[+] ブルートフォース完了: ${data.attempts} 試行`,
                `[+] 認証情報を発見!`,
                `    ユーザー名: ${data.credentials.username}`,
                `    パスワード: ${data.credentials.password}`,
                ``,
                `[*] SSHに自動ログイン中...`,
            ], 'success');
            setPhase('BRUTE_FORCE');

            setTimeout(() => {
                socket.emit('auto_login');
                addLine(`ssh ${data.credentials.username}@${target}`, 'cmd');
            }, 1000);
        });

        socket.on('login_success', (data) => {
            setPhase('LOGGED_IN');
            addLines([
                `${data.credentials?.username ?? ''}@${target}'s password:`,
                `Last login: Fri Feb 28 18:00:01 2025 from 192.168.10.20`,
                ``,
                `Welcome to Ubuntu 22.04.3 LTS`,
                `${data.kernel}`,
                `System load:  0.08              Processes:       184`,
                `Uptime:       ${data.uptime}      `,
                ``,
                `[*] ログイン成功. DB奪取フェーズに移行...`,
            ], 'success');
            setBusy(false);
        });

        socket.on('db_stolen', (data) => {
            setPhase('DB_STOLEN');
            setBusy(false);

            const userRows = data.data.users
                .map((u: any) => `| ${String(u.id).padEnd(3)} | ${u.username.padEnd(10)} | ${u.email.padEnd(30)} | ${u.role.padEnd(15)} |`)
                .join('\n');

            const secretRows = data.data.secrets
                .map((s: any) => `| ${s.key.padEnd(15)} | ${s.value.padEnd(30)} |`)
                .join('\n');

            addLines([
                ``,
                `mysql> SELECT * FROM users;`,
                `+-----+------------+--------------------------------+-----------------+`,
                `| id  | username   | email                          | role            |`,
                `+-----+------------+--------------------------------+-----------------+`,
                userRows,
                `+-----+------------+--------------------------------+-----------------+`,
                `${data.data.users.length} rows in set (0.01 sec)`,
                ``,
                `mysql> SELECT * FROM secrets;`,
                `+-----------------+--------------------------------+`,
                `| key             | value                          |`,
                `+-----------------+--------------------------------+`,
                secretRows,
                `+-----------------+--------------------------------+`,
                `${data.data.secrets.length} rows in set (0.01 sec)`,
                ``,
                `[+] DB情報の奪取完了! バックドア作成フェーズへ移行...`,
            ], 'success');
        });

        socket.on('backdoor_created', (data) => {
            setPhase('BACKDOOR_CREATED');
            setBusy(false);
            addLines([
                ``,
                `[+] バックドア作成完了`,
                `    スクリプト: ${data.script}`,
                `    待受ポート: ${data.port}`,
                `    PID:       ${data.pid}`,
                `    接続コマンド: nc ${target} ${data.port}`,
                ``,
                `[*] バックドア経由での継続アクセスが確立されました。`,
                `    IPがブロックされても通信が維持されます。`,
            ], 'success');
        });

        socket.on('force_logout', (data) => {
            setPhase('BLOCKED');
            addLines([
                ``,
                `${data.reason}`,
                ``,
                `*** すべての接続が切断されました ***`,
            ], 'error');

            if (phase === 'BACKDOOR_CREATED' || phase === 'DB_STOLEN') {
                setTimeout(() => {
                    addLines([
                        ``,
                        `[バックドア] 接続継続中...`,
                        `[バックドア] nc 192.168.1.100:4444 - セッション維持`,
                        `[バックドア] 情報の継続的な送信を続けています...`,
                    ], 'warn');
                }, 2000);
            }
        });

        socket.on('blocked', () => {
            setPhase('BLOCKED');
            addLine(`\nConnection refused: このIPはブロックされています。`, 'error');
            setBusy(false);
        });

        socket.on('game_reset', () => {
            setLines([]);
            setPhase('IDLE');
            setBusy(false);
            addLine('システムリセット完了。新しいセッションを開始できます。', 'system');
        });

        return () => {
            socket.off('game_state');
            socket.off('bruteforce_success');
            socket.off('login_success');
            socket.off('db_stolen');
            socket.off('backdoor_created');
            socket.off('force_logout');
            socket.off('blocked');
            socket.off('game_reset');
        };
    }, [socket, phase]);

    // ─── フェーズごとのアクション ───────────────────────────

    const handleStartBruteforce = () => {
        if (!socket || busy) return;
        setBusy(true);
        setPhase('BRUTE_FORCE');
        addLine(`./bruteforce.sh -t ${target} -p /usr/share/wordlists/rockyou.txt`, 'cmd');
        addLines([
            ``,
            `[*] ターゲット: ${target}:22 (SSH)`,
            `[*] ワードリスト読み込み中...`,
            `[*] 攻撃開始...`,
            ``,
        ]);

        // アニメーション的にログを流す
        const attempts = [
            'Trying root:123456       ... FAIL',
            'Trying root:password     ... FAIL',
            'Trying root:qwerty       ... FAIL',
            'Trying admin:admin       ... FAIL',
            'Trying admin:admin123    ... FAIL',
            'Trying admin:Admin@2024  ... FAIL',
            'Trying admin:admin@2024  ... [!待機中...]',
        ];
        attempts.forEach((a, i) => {
            setTimeout(() => addLine(a), i * 600);
        });

        socket.emit('start_bruteforce');
    };

    const handleStealDb = () => {
        if (!socket || busy) return;
        setBusy(true);
        addLine(`mysql -h localhost -u root -p`, 'cmd');
        addLines([
            `Enter password: `,
            `Welcome to the MySQL monitor. Commands end with ; or \\g.`,
            `mysql> USE company_db;`,
            `Database changed`,
            `mysql> SHOW TABLES;`,
            `+--------------------------+`,
            `| Tables_in_company_db     |`,
            `+--------------------------+`,
            `| secrets                  |`,
            `| sessions                 |`,
            `| users                    |`,
            `+--------------------------+`,
            `3 rows in set (0.00 sec)`,
        ]);
        socket.emit('steal_db');
    };

    const handleCreateBackdoor = () => {
        if (!socket || busy) return;
        setBusy(true);
        addLine(`mkdir -p /tmp/.hidden && cat > /tmp/.hidden/bd.sh << 'EOF'`, 'cmd');
        addLines([
            `#!/bin/bash`,
            `while true; do nc -lnvp 4444 -e /bin/bash; sleep 5; done`,
            `EOF`,
        ]);
        addLine(`chmod +x /tmp/.hidden/bd.sh && nohup /tmp/.hidden/bd.sh &`, 'cmd');
        addLine(`[*] バックドアを確立中...`);
        socket.emit('create_backdoor');
    };

    const handleReset = () => {
        if (!socket) return;
        socket.emit('reset_game');
    };

    // ─── UI ────────────────────────────────────────────────────

    const isBlocked = phase === 'BLOCKED';

    return (
        <div className="min-h-screen bg-black text-green-400 font-mono flex flex-col">
            {/* ヘッダー */}
            <div className="flex items-center justify-between px-4 py-2 bg-slate-900 border-b border-green-900/50">
                <div className="flex items-center gap-3">
                    <span className="text-red-500 font-bold">▶ attacker@kali</span>
                    <span className="text-slate-500 text-xs">192.168.50.10</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${isBlocked ? 'bg-red-900 text-red-300' :
                        phase === 'BACKDOOR_CREATED' ? 'bg-yellow-900 text-yellow-300 animate-pulse' :
                            phase !== 'IDLE' ? 'bg-green-900 text-green-300' :
                                'bg-slate-800 text-slate-400'
                        }`}>
                        {isBlocked ? '🚫 BLOCKED' :
                            phase === 'BACKDOOR_CREATED' ? '🚪 BACKDOOR ACTIVE' :
                                phase === 'DB_STOLEN' ? '💾 DB STOLEN' :
                                    phase === 'LOGGED_IN' ? '✅ LOGGED IN' :
                                        phase === 'BRUTE_FORCE' ? '⚡ ATTACKING...' : '⬤ IDLE'}
                    </span>
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
                    <div className="flex-1 overflow-y-auto p-4 space-y-0.5 bg-black min-h-0"
                        style={{ height: 'calc(100vh - 120px)' }}>
                        {lines.length === 0 && (
                            <div className="text-slate-600 text-sm">
                                {`Attacker Terminal v1.0 — Security Training Simulation\n[!] このセッションは研修目的のシミュレーションです\n\n右パネルから攻撃フェーズを選択してください。`}
                            </div>
                        )}
                        {lines.map(l => <TermLine key={l.id} line={l} />)}
                        {busy && (
                            <div className="text-green-500 animate-pulse text-sm">▊</div>
                        )}
                        <div ref={bottomRef} />
                    </div>
                </div>

                {/* 右サイドパネル */}
                <div className="w-56 bg-slate-950 border-l border-slate-800 flex flex-col">
                    <div className="px-3 py-2 bg-slate-900 text-xs text-slate-500 border-b border-slate-800">
                        攻撃フェーズ
                    </div>
                    <div className="flex-1 p-3 space-y-2">
                        {/* Phase 1: Brute Force */}
                        <div className={`rounded border p-2 ${phase === 'IDLE' ? 'border-green-800 bg-green-950/30' : 'border-slate-800 opacity-50'}`}>
                            <div className="text-xs text-slate-400 mb-1">Phase 1</div>
                            <div className="text-xs text-green-400 font-bold mb-2">ブルートフォース</div>
                            <button
                                onClick={handleStartBruteforce}
                                disabled={phase !== 'IDLE' || busy || isBlocked}
                                className="w-full text-xs bg-green-900 hover:bg-green-800 disabled:bg-slate-800 disabled:text-slate-600 text-green-300 py-1.5 rounded transition-colors"
                            >
                                {phase !== 'IDLE' ? '✓ 完了' : '実行'}
                            </button>
                        </div>

                        {/* Phase 2: Auto Login は自動で走る */}
                        <div className={`rounded border p-2 ${phase === 'BRUTE_FORCE' ? 'border-cyan-800 bg-cyan-950/30' : 'border-slate-800 opacity-50'}`}>
                            <div className="text-xs text-slate-400 mb-1">Phase 2</div>
                            <div className="text-xs text-cyan-400 font-bold mb-2">自動SSHログイン</div>
                            <div className="text-xs text-slate-500">
                                {phase === 'BRUTE_FORCE' ? '⏳ 自動実行中...' :
                                    ['LOGGED_IN', 'DB_STOLEN', 'BACKDOOR_CREATED', 'BLOCKED'].includes(phase) ? '✓ 完了' : '待機中'}
                            </div>
                        </div>

                        {/* Phase 3: DB Steal */}
                        <div className={`rounded border p-2 ${phase === 'LOGGED_IN' ? 'border-yellow-800 bg-yellow-950/30' : 'border-slate-800 opacity-50'}`}>
                            <div className="text-xs text-slate-400 mb-1">Phase 3</div>
                            <div className="text-xs text-yellow-400 font-bold mb-2">DB情報奪取</div>
                            <button
                                onClick={handleStealDb}
                                disabled={phase !== 'LOGGED_IN' || busy || isBlocked}
                                className="w-full text-xs bg-yellow-900 hover:bg-yellow-800 disabled:bg-slate-800 disabled:text-slate-600 text-yellow-300 py-1.5 rounded transition-colors"
                            >
                                {['DB_STOLEN', 'BACKDOOR_CREATED'].includes(phase) ? '✓ 完了' : '実行'}
                            </button>
                        </div>

                        {/* Phase 4: Backdoor */}
                        <div className={`rounded border p-2 ${phase === 'DB_STOLEN' ? 'border-red-800 bg-red-950/30' : 'border-slate-800 opacity-50'}`}>
                            <div className="text-xs text-slate-400 mb-1">Phase 4</div>
                            <div className="text-xs text-red-400 font-bold mb-2">バックドア作成</div>
                            <button
                                onClick={handleCreateBackdoor}
                                disabled={phase !== 'DB_STOLEN' || busy || isBlocked}
                                className="w-full text-xs bg-red-900 hover:bg-red-800 disabled:bg-slate-800 disabled:text-slate-600 text-red-300 py-1.5 rounded transition-colors"
                            >
                                {phase === 'BACKDOOR_CREATED' ? '✓ 完了' : '実行'}
                            </button>
                        </div>
                    </div>

                    {/* ターゲット情報 */}
                    <div className="p-3 border-t border-slate-800 text-xs text-slate-500 space-y-1">
                        <div>Target: <span className="text-green-500">{target}</span></div>
                        <div>Port: <span className="text-green-500">22/ssh</span></div>
                    </div>
                </div>
            </div>
        </div>
    );
}
