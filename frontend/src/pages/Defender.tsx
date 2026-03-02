import { useState, useEffect, useRef } from 'react';
import { Socket } from 'socket.io-client';
import { useLocation, useNavigate } from 'react-router-dom';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

interface DefenderProps {
    socket: Socket | null;
}



interface DamageCandidate {
    id: string;
    path: string;
    description: string;
    isCorrect: boolean;
}

export function Defender({ socket }: DefenderProps) {
    const navigate = useNavigate();
    const location = useLocation();
    const roomId = new URLSearchParams(location.search).get('room') || 'UNKNOWN_ROOM';

    const [, setGameState] = useState<any>(null);
    const [alertActive, setAlertActive] = useState(false);
    const [, setAttackerIp] = useState('');
    const [panel, setPanel] = useState<'terminal' | 'investigate'>('terminal');
    const [damageCandidates, setDamageCandidates] = useState<DamageCandidate[]>([]);
    const [investigationDone, setInvestigationDone] = useState(false);
    const [backdoorPid, setBackdoorPid] = useState<number | null>(null);
    const [backdoorActive, setBackdoorActive] = useState(false);
    const [gameClear, setGameClear] = useState(false);
    const [blocked, setBlocked] = useState(false);

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
                background: '#0f172a', // slate-950
                foreground: '#cbd5e1', // slate-300
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

    useEffect(() => {
        if (!socket) {
            navigate('/');
            return;
        }

        socket.emit('join_room', { roomId, role: 'DEFENDER' });

        socket.on('pty_output', (data) => {
            xtermRef.current?.write(data.output);
        });

        socket.on('disconnect', () => {
            writeXterm('\r\nサーバーとの接続が切れました。\r\n', '31');
            setGameState((prev: any) => ({ ...prev, phase: 'WAITING' }));
        });

        socket.on('game_state', (state) => {
            setGameState(state);
            if (state.phase === 'WAITING') {
                writeXterm('\r\nゲーム開始を待機中...\r\n', '35');
            } else if (state.phase === 'IDLE') {
                writeXterm('\r\nゲーム開始。攻撃者の接続を待機中...\r\n', '35');
            }
        });

        socket.on('bruteforce_detected', (data) => {
            setAlertActive(true);
            setAttackerIp(data.ip);
            writeXterm(`\r\n\r\n╔══════════════════════════════════════════════════════════╗\r\n║  🚨 セキュリティアラート: 攻撃を検知しました        🚨  ║\r\n║   ${data.message}   ║\r\n║   発生時刻: ${new Date(data.timestamp).toLocaleTimeString()}                                 ║\r\n╚══════════════════════════════════════════════════════════╝\r\n`, '41;37');
            setTimeout(() => setAlertActive(false), 8000);
        });

        socket.on('block_result', (data) => {
            if (data.success) {
                writeXterm(`\r\n[+] IPブロック完了。攻撃者の接続を切断しました。\r\n`, '32');
                setBlocked(true);
            } else {
                writeXterm(`\r\n[!] ${data.message}\r\n`, '31');
            }
        });

        socket.on('backdoor_still_active', (data) => {
            setBackdoorActive(true);
            setBackdoorPid(data.pid);
            writeXterm(`\r\n⚠️  警告: ${data.message}\r\n   ポート 4444 で通信が継続中(PID: ${data.pid})\r\n   「被害調査」タブで詳細を確認してください。\r\n`, '33');
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
                writeXterm(`\r\n[+] バックドア(${data.value}) を正常に遮断しました。\r\n`, '32');
                setPanel('terminal');
            } else {
                writeXterm(`\r\n[!] ${data.message}\r\n`, '31');
            }
        });

        socket.on('game_clear', (data) => {
            setGameClear(true);
            writeXterm(`\r\n\r\n╔══════════════════════════════════════════════════════╗\r\n║  ✅ インシデント対応完了                              ║\r\n║  ${data.message}  ║\r\n╚══════════════════════════════════════════════════════╝\r\n`, '32');
        });

        socket.on('game_reset', () => {
            xtermRef.current?.clear();
            setAlertActive(false);
            setAttackerIp('');
            setPanel('terminal');
            setDamageCandidates([]);
            setInvestigationDone(false);
            setBackdoorPid(null);
            setBackdoorActive(false);
            setGameClear(false);
            setBlocked(false);
            setGameState({ phase: 'WAITING', dbStolen: false, backdoorActive: false });
            writeXterm('\r\nシステムリセット完了。待機状態です。\r\n', '35');
        });

        return () => {
            socket.off('pty_output');
            socket.off('disconnect');
            socket.off('game_state');
            socket.off('bruteforce_detected');
            socket.off('block_result');
            socket.off('backdoor_still_active');
            socket.off('damage_report');
            socket.off('backdoor_removed');
            socket.off('game_clear');
            socket.off('game_reset');
        };
    }, [socket, roomId, navigate]);

    const handleCandidateSelect = (c: DamageCandidate) => {
        if (c.isCorrect) {
            setInvestigationDone(true);
            writeXterm(`\r\n[!] ${c.path} への不正アクセス痕跡を確認。DB情報が抜き取られていました。\r\n`, '33');
            if (backdoorActive) {
                writeXterm(`\r\n[!] バックドアプロセス(PID: ${backdoorPid}) が現在も稼働中。「ps aux」で確認後、遮断してください。\r\n`, '33');
            }
            setPanel('terminal');
        } else {
            writeXterm(`\r\n[調査] ${c.path}: 変更の痕跡なし\r\n`, '37');
        }
    };

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
                    <div className="bg-blue-950/40 border border-blue-900/50 px-4 py-1 flex items-center gap-2 rounded text-sm text-blue-300 font-mono">
                        ROOM: {roomId}
                    </div>
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
                    onClick={() => { setPanel('terminal'); setTimeout(() => fitAddonRef.current?.fit(), 100); }}
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

            {/* ─── ターミナルパネル (DOMは常に存在させ、displayで表示切替) ───────────────────────── */}
            <div
                className="flex-1 p-4"
                style={{
                    display: panel === 'terminal' ? 'block' : 'none',
                    minHeight: 'calc(100vh - 110px)'
                }}
            >
                <div ref={terminalRef} className="w-full h-full" />
            </div>

            {/* ─── 被害調査パネル ─────────────────────────── */}
            {panel === 'investigate' && (
                <div className="flex-1 overflow-y-auto p-6 space-y-6" style={{ minHeight: 'calc(100vh - 110px)' }}>
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
                                onClick={() => { setPanel('terminal'); setTimeout(() => fitAddonRef.current?.fit(), 100); }}
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
