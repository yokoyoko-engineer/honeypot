import { useState, useEffect, useRef } from 'react';
import { Socket } from 'socket.io-client';
import { useNavigate } from 'react-router-dom';

interface DefenderProps {
    socket: Socket | null;
}

interface TerminalLine {
    id: string;
    text: string;
    type: 'cmd' | 'output' | 'success' | 'error' | 'warn' | 'system' | 'alert';
}

interface DamageCandidate {
    id: string;
    path: string;
    description: string;
    isCorrect: boolean;
}

function uid() { return Math.random().toString(36).slice(2, 9); }

function TermLine({ line }: { line: TerminalLine }) {
    const colors: Record<string, string> = {
        cmd: 'text-blue-300',
        output: 'text-slate-300',
        success: 'text-green-400',
        error: 'text-red-400',
        warn: 'text-yellow-300',
        system: 'text-purple-400',
        alert: 'text-red-300 bg-red-950/40 px-2 py-0.5 rounded border-l-2 border-red-500',
    };
    return (
        <div className={`font-mono text-sm leading-relaxed whitespace-pre-wrap ${colors[line.type]}`}>
            {line.type === 'cmd'
                ? <><span className="text-blue-600 mr-1">defender@server:~$</span>{line.text}</>
                : line.text
            }
        </div>
    );
}

export function Defender({ socket }: DefenderProps) {
    const navigate = useNavigate();
    const [lines, setLines] = useState<TerminalLine[]>([]);
    const [input, setInput] = useState('');
    const [cmdHistory, setCmdHistory] = useState<string[]>([]);
    const [histIdx, setHistIdx] = useState(-1);
    const [alertActive, setAlertActive] = useState(false);
    const [, setAttackerIp] = useState('');
    const [panel, setPanel] = useState<'terminal' | 'investigate'>('terminal');
    const [damageCandidates, setDamageCandidates] = useState<DamageCandidate[]>([]);
    const [investigationDone, setInvestigationDone] = useState(false);
    const [backdoorPid, setBackdoorPid] = useState<number | null>(null);
    const [backdoorActive, setBackdoorActive] = useState(false);
    const [gameClear, setGameClear] = useState(false);
    const [blocked, setBlocked] = useState(false);
    const bottomRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const addLine = (text: string, type: TerminalLine['type'] = 'output') => {
        setLines(prev => [...prev, { id: uid(), text, type }]);
    };
    const addLines = (texts: string[], type: TerminalLine['type'] = 'output') => {
        setLines(prev => [...prev, ...texts.map(text => ({ id: uid(), text, type }))]);
    };

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [lines]);

    useEffect(() => {
        if (!socket) return;

        socket.on('bruteforce_detected', (data) => {
            setAlertActive(true);
            setAttackerIp(data.ip);
            addLines([
                ``,
                `╔══════════════════════════════════════════════════════════╗`,
                `║  🚨 セキュリティアラート: 攻撃を検知しました        🚨  ║`,
                `║   ${data.message}   ║`,
                `║   発生時刻: ${new Date(data.timestamp).toLocaleTimeString()}                                 ║`,
                `╚══════════════════════════════════════════════════════════╝`,
            ], 'alert');

            setTimeout(() => setAlertActive(false), 8000);
        });

        socket.on('logs_data', (data) => {
            setAttackerIp(data.attackerIp);
            addLine(`\n--- /var/log/auth.log の内容 ---`);
            data.authlog.forEach((line: string) => addLine(line, 'output'));
            addLine(`--- ログ終端 ---\n`);
        });

        socket.on('netstat_data', (data) => {
            addLine(`\n--- netstat 出力 ---`);
            addLine(data.output, 'output');
            addLine(`---\n`);
        });

        socket.on('block_result', (data) => {
            if (data.success) {
                addLine(data.message, 'success');
                addLine(`[+] IPブロック完了。攻撃者の接続を切断しました。`, 'success');
                setBlocked(true);
            } else {
                addLine(`iptables: ${data.message}`, 'error');
            }
        });

        socket.on('backdoor_still_active', (data) => {
            setBackdoorActive(true);
            setBackdoorPid(data.pid);
            addLines([
                ``,
                `⚠️  警告: ${data.message}`,
                `   ポート 4444 で通信が継続中 (PID: ${data.pid})`,
                `   「被害調査」タブで詳細を確認してください。`,
            ], 'warn');
        });

        socket.on('damage_report', (data) => {
            setDamageCandidates(data.candidates);
            setBackdoorActive(data.backdoorActive);
            setBackdoorPid(data.backdoorPid);
            setPanel('investigate');
        });

        socket.on('backdoor_removed', (data) => {
            if (data.success) {
                setBackdoorActive(false);
                addLine(`\n[+] バックドア (${data.value}) を正常に遮断しました。`, 'success');
                setPanel('terminal');
            } else {
                addLine(`\n${data.message}`, 'error');
            }
        });

        socket.on('game_clear', (data) => {
            setGameClear(true);
            addLines([
                ``,
                `╔══════════════════════════════════════════════════════╗`,
                `║  ✅ インシデント対応完了                              ║`,
                `║  ${data.message}  ║`,
                `╚══════════════════════════════════════════════════════╝`,
            ], 'success');
        });

        socket.on('game_reset', () => {
            setLines([]);
            setAlertActive(false);
            setAttackerIp('');
            setPanel('terminal');
            setDamageCandidates([]);
            setInvestigationDone(false);
            setBackdoorPid(null);
            setBackdoorActive(false);
            setGameClear(false);
            setBlocked(false);
            addLine('システムリセット完了。待機状態です。', 'system');
        });

        return () => {
            socket.off('bruteforce_detected');
            socket.off('logs_data');
            socket.off('netstat_data');
            socket.off('block_result');
            socket.off('backdoor_still_active');
            socket.off('damage_report');
            socket.off('backdoor_removed');
            socket.off('game_clear');
            socket.off('game_reset');
        };
    }, [socket]);

    // ─── コマンド処理 ──────────────────────────────────────────
    const handleCommand = (rawCmd: string) => {
        const cmd = rawCmd.trim();
        if (!cmd) return;

        addLine(cmd, 'cmd');
        setCmdHistory(prev => [cmd, ...prev].slice(0, 50));
        setHistIdx(-1);
        setInput('');

        // ─── tail -f /var/log/auth.log ────────────────
        if (cmd.match(/^tail\s+(-f\s+)?\/var\/log\/auth\.log/)) {
            socket?.emit('get_logs');
            return;
        }

        // ─── netstat ──────────────────────────────────
        if (cmd.match(/^netstat\b/)) {
            socket?.emit('get_netstat');
            return;
        }

        // ─── iptables でIPブロック ─────────────────────
        const iptablesMatch = cmd.match(/^iptables\s+-A\s+INPUT\s+-s\s+([\d.]+)\s+-j\s+DROP/);
        if (iptablesMatch) {
            const ip = iptablesMatch[1];
            socket?.emit('block_attacker', { ip });
            addLine(`iptables: ルール追加を試みています (-s ${ip} -j DROP)...`);
            return;
        }

        // ─── kill <PID> ───────────────────────────────
        const killMatch = cmd.match(/^kill\s+(-9\s+)?(\d+)/);
        if (killMatch) {
            const pid = parseInt(killMatch[2]);
            socket?.emit('remove_backdoor', { method: 'kill', value: pid });
            addLine(`kill: PID ${pid} にシグナルを送信中...`);
            return;
        }

        // ─── rm でバックドアを削除 ─────────────────────
        const rmMatch = cmd.match(/^rm\s+(-rf?\s+)?(.+)/);
        if (rmMatch) {
            const path = rmMatch[2];
            socket?.emit('remove_backdoor', { method: 'rm', value: path });
            addLine(`rm: ${path} を削除中...`);
            return;
        }

        // ─── find でバックドアを探す ──────────────────
        if (cmd.match(/^find\b/)) {
            if (backdoorActive) {
                addLines([
                    `/tmp/.hidden/bd.sh`,
                    `/tmp/.hidden/.nohup.out`,
                    ``,
                    `不審なファイルを発見しました。「kill <PID>」または「rm -rf /tmp/.hidden」で対処できます。`,
                ], 'warn');
            } else {
                addLine(`（不審なファイルは見つかりませんでした）`);
            }
            return;
        }

        // ─── ps aux ───────────────────────────────────
        if (cmd.match(/^ps\b/)) {
            const lines = [
                `USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND`,
                `root           1  0.0  0.1 103444 10220 ?        Ss   08:00   0:01 /sbin/init`,
                `root         987  0.0  0.1  72312  5860 ?        Ss   08:00   0:00 sshd: /usr/sbin/sshd -D`,
                `root        1023  0.0  1.2 589672 51200 ?        Ssl  08:00   0:08 /usr/sbin/mysqld`,
                `root        2007  0.0  0.0  14548  3200 ?        Ss   11:45   0:00 sshd: admin [priv]`,
                ...(backdoorActive ? [
                    `root    ${backdoorPid ?? 9999}  0.0  0.0   4288  1024 ?        S    11:45   0:00 /bin/bash /tmp/.hidden/bd.sh`,
                    `root    ${(backdoorPid ?? 9999) + 1}  0.0  0.0   2444   904 ?        S    11:45   0:00 nc -lnvp 4444 -e /bin/bash`,
                ] : []),
            ];
            addLines(lines);
            return;
        }

        // ─── clear ────────────────────────────────────
        if (cmd === 'clear') {
            setLines([]);
            return;
        }

        // ─── 被害調査 ──────────────────────────────────
        if (cmd === 'investigate' || cmd === 'sudo investigate') {
            socket?.emit('investigate_damage');
            addLine(`被害調査を開始します...`, 'system');
            return;
        }

        // ─── help ─────────────────────────────────────
        if (cmd === 'help') {
            addLines([
                ``,
                `利用可能なコマンド:`,
                `  tail -f /var/log/auth.log  : リアルタイムログ確認`,
                `  netstat -an                 : ネットワーク接続確認`,
                `  ps aux                      : プロセス確認`,
                `  find /tmp -name "*.sh"      : 不審ファイル探索`,
                `  iptables -A INPUT -s <IP> -j DROP  : IPブロック`,
                `  kill -9 <PID>               : プロセス強制終了`,
                `  rm -rf /tmp/.hidden         : バックドアファイル削除`,
                `  investigate                 : 被害調査パネルを開く`,
                `  clear                       : 画面クリア`,
                ``,
            ]);
            return;
        }

        // 不明コマンド
        addLine(`bash: ${cmd}: command not found`, 'error');
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            handleCommand(input);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            const next = Math.min(histIdx + 1, cmdHistory.length - 1);
            setHistIdx(next);
            setInput(cmdHistory[next] ?? '');
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            const next = Math.max(histIdx - 1, -1);
            setHistIdx(next);
            setInput(next === -1 ? '' : cmdHistory[next]);
        }
    };

    const handleCandidateSelect = (c: DamageCandidate) => {
        if (c.isCorrect) {
            setInvestigationDone(true);
            addLine(`\n[!] ${c.path} への不正アクセス痕跡を確認。DB情報が抜き取られていました。`, 'warn');
            if (backdoorActive) {
                addLine(`[!] バックドアプロセス (PID: ${backdoorPid}) が現在も稼働中。「ps aux」で確認後、遮断してください。`, 'warn');
            }
            setPanel('terminal');
        } else {
            addLine(`\n[調査] ${c.path}: 変更の痕跡なし`, 'output');
        }
    };

    // ─── UI ────────────────────────────────────────────────────
    return (
        <div className={`min-h-screen bg-slate-950 text-slate-300 font-mono flex flex-col transition-colors duration-300 ${alertActive ? 'bg-red-950/20' : ''}`}>

            {/* アラートバナー */}
            {alertActive && (
                <div className="bg-red-700 text-white text-center py-2 px-4 text-sm font-bold animate-pulse">
                    🚨 セキュリティアラート: SSH ブルートフォース攻撃を検知 — ログを確認してください
                </div>
            )}

            {/* ヘッダー */}
            <div className="flex items-center justify-between px-4 py-2 bg-slate-900 border-b border-slate-700">
                <div className="flex items-center gap-3">
                    <span className="text-blue-400 font-bold">▶ defender@server</span>
                    <span className="text-slate-500 text-xs">192.168.1.100</span>
                    {blocked && <span className="text-xs bg-green-900 text-green-300 px-2 py-0.5 rounded-full">🛡 攻撃者ブロック済み</span>}
                    {backdoorActive && <span className="text-xs bg-red-900 text-red-300 px-2 py-0.5 rounded-full animate-pulse">⚠ バックドア検出</span>}
                    {gameClear && <span className="text-xs bg-emerald-900 text-emerald-300 px-2 py-0.5 rounded-full">✅ インシデント解決</span>}
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={() => { socket?.emit('investigate_damage'); setPanel('investigate'); }}
                        className="text-xs border border-yellow-700 text-yellow-400 hover:bg-yellow-900/30 px-2 py-1 rounded"
                    >
                        被害調査
                    </button>
                    <button onClick={() => navigate('/')} className="text-slate-500 hover:text-white text-xs border border-slate-700 px-2 py-1 rounded">← Back</button>
                </div>
            </div>

            {/* タブ */}
            <div className="flex border-b border-slate-800 bg-slate-900">
                <button
                    onClick={() => setPanel('terminal')}
                    className={`px-4 py-1.5 text-xs font-medium transition-colors ${panel === 'terminal' ? 'text-blue-400 border-b-2 border-blue-500' : 'text-slate-500 hover:text-slate-300'}`}
                >
                    Terminal
                </button>
                <button
                    onClick={() => setPanel('investigate')}
                    className={`px-4 py-1.5 text-xs font-medium transition-colors ${panel === 'investigate' ? 'text-yellow-400 border-b-2 border-yellow-500' : 'text-slate-500 hover:text-slate-300'}`}
                >
                    被害調査 {backdoorActive && '⚠'}
                </button>
            </div>

            {/* ─── ターミナルパネル ───────────────────────── */}
            {panel === 'terminal' && (
                <div className="flex flex-col flex-1" style={{ height: 'calc(100vh - 110px)' }}>
                    {/* 出力エリア */}
                    <div
                        className="flex-1 overflow-y-auto p-4 space-y-0.5 cursor-text"
                        onClick={() => inputRef.current?.focus()}
                    >
                        {lines.length === 0 && (
                            <div className="text-slate-600 text-sm whitespace-pre-wrap">
                                {`Defender Terminal — Security Training Simulation
サーバー: 192.168.1.100 (Ubuntu 22.04)

「help」でコマンド一覧を表示できます。
攻撃者からのアラートを待機中...`}
                            </div>
                        )}
                        {lines.map(l => <TermLine key={l.id} line={l} />)}
                        <div ref={bottomRef} />
                    </div>

                    {/* 入力エリア */}
                    <div className="border-t border-slate-800 bg-slate-900 px-4 py-2 flex items-center gap-2">
                        <span className="text-blue-500 text-sm shrink-0">defender@server:~$</span>
                        <input
                            ref={inputRef}
                            value={input}
                            onChange={e => setInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            className="flex-1 bg-transparent text-slate-200 text-sm outline-none font-mono"
                            placeholder="コマンドを入力 (help で一覧表示)"
                            autoFocus
                            autoComplete="off"
                            spellCheck={false}
                        />
                    </div>
                </div>
            )}

            {/* ─── 被害調査パネル ─────────────────────────── */}
            {panel === 'investigate' && (
                <div className="flex-1 overflow-y-auto p-6 space-y-6" style={{ height: 'calc(100vh - 110px)' }}>
                    <div>
                        <h2 className="text-yellow-400 font-bold text-sm mb-1">📋 被害範囲調査</h2>
                        <p className="text-slate-500 text-xs">
                            不審なアクセスが検知されました。どの箇所に被害があったか特定してください。
                        </p>
                    </div>

                    {/* 候補リスト */}
                    {damageCandidates.length > 0 ? (
                        <div className="space-y-3">
                            <p className="text-xs text-slate-400">以下の候補からアクセス証跡があった箇所を選択してください:</p>
                            {damageCandidates.map(c => (
                                <button
                                    key={c.id}
                                    onClick={() => handleCandidateSelect(c)}
                                    className="w-full text-left p-3 rounded border border-slate-700 hover:border-yellow-700 hover:bg-yellow-950/20 transition-colors"
                                >
                                    <div className="text-xs text-slate-200 font-mono mb-1">{c.path}</div>
                                    <div className="text-xs text-slate-500">{c.description}</div>
                                </button>
                            ))}
                        </div>
                    ) : (
                        <div className="text-slate-500 text-xs">
                            攻撃が発生してから「被害調査」を実行してください。
                            <br />ターミナルに戻り <code className="text-blue-400">investigate</code> と入力するか、上の「被害調査」ボタンを押してください。
                        </div>
                    )}

                    {/* バックドア対応 */}
                    {investigationDone && backdoorActive && (
                        <div className="mt-4 p-4 border border-red-800 rounded bg-red-950/30 text-sm space-y-3">
                            <div className="text-red-400 font-bold">⚠️ バックドアが検出されました</div>
                            <p className="text-slate-400 text-xs">
                                PID <span className="text-yellow-400">{backdoorPid}</span> のプロセスがポート 4444 でネットワーク接続を維持し続けています。
                                ターミナルに戻り、以下のコマンドで対処してください:
                            </p>
                            <div className="bg-black/40 rounded p-2 text-xs space-y-1">
                                <div className="text-slate-500"># プロセスを確認</div>
                                <div className="text-blue-300">$ ps aux | grep {backdoorPid}</div>
                                <div className="text-slate-500 mt-2"># プロセスを終了</div>
                                <div className="text-blue-300">$ kill -9 {backdoorPid}</div>
                                <div className="text-slate-500 mt-2"># またはスクリプトを削除</div>
                                <div className="text-blue-300">$ rm -rf /tmp/.hidden</div>
                            </div>
                            <button
                                onClick={() => setPanel('terminal')}
                                className="text-xs bg-blue-900 hover:bg-blue-800 text-blue-300 px-3 py-1.5 rounded"
                            >
                                ターミナルに戻る
                            </button>
                        </div>
                    )}

                    {investigationDone && !backdoorActive && (
                        <div className="p-4 border border-green-800 rounded bg-green-950/20 text-sm">
                            <div className="text-green-400 font-bold">✅ バックドアは遮断されています</div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
