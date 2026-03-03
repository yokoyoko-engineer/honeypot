import { useState, useEffect, useRef } from 'react';
import { Socket } from 'socket.io-client';
import { useLocation, useNavigate } from 'react-router-dom';

interface AttackerProps {
    socket: Socket | null;
}

interface TerminalLine {
    id: string;
    text: string;
    type: 'cmd' | 'output' | 'success' | 'error' | 'warn' | 'system';
}

type GamePhase = 'WAITING' | 'IDLE' | 'ATTACKING' | 'ATTACK_SUCCESS' | 'BLOCKED' | 'COMPLETED';

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
        <div className={`font - mono text - sm leading - relaxed whitespace - pre - wrap ${colors[line.type]} `}>
            {line.type === 'cmd' && <span className="text-green-600 mr-1">$</span>}
            {line.text}
        </div>
    );
}

export function Attacker({ socket }: AttackerProps) {
    const navigate = useNavigate();
    const location = useLocation();
    const roomId = new URLSearchParams(location.search).get('room') || 'UNKNOWN_ROOM';

    const [terminalOutput, setTerminalOutput] = useState<TerminalLine[]>([]);
    const [phase, setPhase] = useState<GamePhase>('WAITING');
    const [busy, setBusy] = useState(false);
    const [target] = useState('192.168.1.100');
    const [selectedAttack, setSelectedAttack] = useState<string>('ssh');
    const [isBlocked, setIsBlocked] = useState(false);
    const bottomRef = useRef<HTMLDivElement>(null);

    const addLine = (text: string, type: TerminalLine['type'] = 'output') => {
        setTerminalOutput(prev => [...prev, { id: uid(), text, type }]);
    };

    const addLines = (texts: string[], type: TerminalLine['type'] = 'output') => {
        const newLines = texts.map(text => ({ id: uid(), text, type }));
        setTerminalOutput(prev => [...prev, ...newLines]);
    };

    // 自動スクロール
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [terminalOutput]);

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

        socket.on('game_state', (data) => {
            setPhase(data.phase);
            setIsBlocked(data.phase === 'BLOCKED');
        });

        socket.on('attack_success', (data) => {
            setBusy(false);
            setPhase('ATTACK_SUCCESS');
            addLines([
                ``,
                `[+] 攻撃成功: ${data.attackName}`,
                `${data.detail}`,
                ``,
                `[*] フェーズ2: エクスプロイトを実行中...`,
            ], 'success');

            setTimeout(() => {
                socket.emit('execute_exploit');
                addLine(`[*] エクスプロイト ペイロード送信中...`, 'cmd');
            }, 1500);
        });

        socket.on('exploit_success', (data) => {
            setPhase('COMPLETED');
            addLines([
                ``,
                `[+] ${data.message}`,
                ``,
                `[*] 目的を達成しました。システムへの継続的アクセスを確立中...`,
                `    防御側が対処するのを待ちます。`,
            ], 'success');
            setBusy(false);
        });

        socket.on('force_logout', (data) => {
            setIsBlocked(true);
            addLines([
                ``,
                `${data.reason}`,
                ``,
                `*** すべての接続が切断されました ***`,
            ], 'error');

            if (phase === 'COMPLETED' || phase === 'ATTACK_SUCCESS') {
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
            setIsBlocked(true);
            addLine(`\nConnection refused: このIPはブロックされています。`, 'error');
            setBusy(false);
        });

        socket.on('game_reset', () => {
            setTerminalOutput([]);
            setPhase('IDLE');
            setBusy(false);
            setIsBlocked(false);
            addLine('システムリセット完了。新しいセッションを開始できます。', 'system');
        });

        return () => {
            socket.off('game_state');
            socket.off('attack_success');
            socket.off('exploit_success');
            socket.off('force_logout');
            socket.off('blocked');
            socket.off('game_reset');
            socket.off('disconnect');
        };
    }, [socket, phase, roomId, navigate]);

    // ─── フェーズごとのアクション ───────────────────────────

    const handleStartAttack = () => {
        if (!socket || busy) return;
        setBusy(true);
        setPhase('ATTACKING');
        const attackMeta = ATTACKS.find(a => a.id === selectedAttack);

        addLine(`[*] 攻撃開始: ${attackMeta?.name}`, 'warn');
        addLine(`[*] Target: ${target}`);
        addLine(`[*] Exploit payload initialized...`, 'cmd');

        // シンプルな待機アニメーション
        const attempts = ['.', '..', '...', 'Payload injected', 'Waiting for response...'];
        attempts.forEach((a, i) => {
            setTimeout(() => addLine(a), (i + 1) * 600);
        });

        socket.emit('start_attack', { attackType: selectedAttack });
    };

    const handleReset = () => {
        if (!socket) return;
        socket.emit('reset_game');
    };

    // ─── UI ────────────────────────────────────────────────────

    if (phase === 'WAITING') {
        return (
            <div className="min-h-screen bg-[#0a0f12] text-[#00ffcc] font-mono flex flex-col items-center justify-center p-8">
                <div className="text-2xl mb-4 font-bold animate-pulse text-red-500">ATTACK SQUAD - Waiting for Target</div>
                <div className="text-slate-400 mb-8">Room: {roomId} に防御側が参加するのを待機しています...</div>
                <button
                    onClick={() => navigate('/')}
                    className="px-6 py-2 border border-red-900/50 bg-red-950/20 hover:bg-red-900/50 text-red-500 rounded transition-colors"
                >
                    Leave Room
                </button>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-black text-green-400 font-mono flex flex-col">
            {/* ヘッダー */}
            <div className="flex items-center justify-between px-4 py-2 bg-slate-900 border-b border-green-900/50">
                <div className="flex items-center gap-3">
                    <span className="text-red-500 font-bold">▶ attacker@kali</span>
                    <span className="text-slate-500 text-xs">192.168.50.10</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${isBlocked ? 'bg-red-900 text-red-300' :
                        phase === 'COMPLETED' ? 'bg-yellow-900 text-yellow-300' :
                            phase !== 'IDLE' ? 'bg-green-900 text-green-300' :
                                'bg-slate-800 text-slate-400'
                        }`}>
                        {isBlocked ? '🚫 BLOCKED' :
                            phase === 'COMPLETED' ? '🚪 EXPLOIT ACTIVE' :
                                phase === 'ATTACK_SUCCESS' ? '✅ TARGET BREACHED' :
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
                    <div className="flex-1 overflow-y-auto p-4 space-y-0.5 bg-black min-h-0"
                        style={{ minHeight: 'calc(100vh - 120px)' }}>
                        {terminalOutput.length === 0 && (
                            <div className="text-slate-600 text-sm">
                                {`Attacker Terminal v1.0 — Security Training Simulation\n[!] このセッションは研修目的のシミュレーションです\n\n右パネルから攻撃フェーズを選択してください。`}
                            </div>
                        )}
                        {terminalOutput.map((l: TerminalLine) => <TermLine key={l.id} line={l} />)}
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
                            <button
                                onClick={handleStartAttack}
                                disabled={phase !== 'IDLE' || busy || isBlocked}
                                className="w-full text-xs font-bold bg-red-950 hover:bg-red-900 border border-red-900 disabled:bg-slate-900 disabled:border-slate-800 disabled:text-slate-600 text-red-400 py-2 rounded transition-colors"
                            >
                                {phase !== 'IDLE' ? '攻撃実行済み' : '▶ 攻撃を実行'}
                            </button>
                            {phase === 'COMPLETED' && (
                                <div className="text-center text-[10px] text-green-500 mt-2 animate-pulse">
                                    [継続アクセス確立中]
                                </div>
                            )}
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
