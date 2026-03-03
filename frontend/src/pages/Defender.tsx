import { useState, useEffect, useRef } from 'react';
import { Socket } from 'socket.io-client';
import { useLocation, useNavigate } from 'react-router-dom';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

interface DefenderProps {
    socket: Socket | null;
}


export function Defender({ socket }: DefenderProps) {
    const navigate = useNavigate();
    const location = useLocation();
    const roomId = new URLSearchParams(location.search).get('room') || 'UNKNOWN_ROOM';

    const [, setGameState] = useState<any>(null);
    const [alertActive, setAlertActive] = useState(false);
    const [, setAttackerIp] = useState('');
    const [panel, setPanel] = useState<'terminal' | 'playbook'>('terminal');
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

        socket.on('attack_detected', (data) => {
            setAlertActive(true);
            setAttackerIp(data.ip);
            writeXterm(`\r\n\r\n╔══════════════════════════════════════════════════════════╗\r\n║  🚨 セキュリティアラート: 異常なネットワーク活動を検知    🚨  ║\r\n║   ${data.message}   ║\r\n║   発生時刻: ${new Date(data.timestamp).toLocaleTimeString()}                                 ║\r\n╚══════════════════════════════════════════════════════════╝\r\n`, '41;37');
            writeXterm(`\r\n[システム] 「Playbook（対応マニュアル）」タブを開き、調査手順に従って対応してください。\r\n`, '33');
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
            writeXterm(`\r\n⚠️  警告: ${data.message}\r\n   ポート 4444 で通信が継続中(PID: ${data.pid})\r\n   「被害調査」タブで詳細を確認してください。\r\n`, '33');
        });

        socket.on('damage_report', () => {
            // ターミナルから操作させるためUIでは処理しない
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
            socket.off('attack_detected');
            socket.off('block_result');
            socket.off('backdoor_still_active');
            socket.off('damage_report');
            socket.off('backdoor_removed');
            socket.off('game_clear');
            socket.off('game_reset');
        };
    }, [socket, roomId, navigate]);



    return (
        <div className={`min-h-screen bg-slate-950 text-slate-300 font-mono flex flex-col transition-colors duration-300 ${alertActive ? 'bg-red-950/20' : ''}`}>

            {/* アラートバナー */}
            {alertActive && (
                <div className="bg-red-700 text-white text-center py-2 px-4 text-sm font-bold animate-pulse">
                    🚨 セキュリティアラート: 未知の脅威を検知 — Playbookを確認し、ログ調査と対処を実行してください
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
                    onClick={() => setPanel('playbook')}
                    className={`px-4 py-1.5 text-xs font-medium transition-colors ${panel === 'playbook' ? 'text-yellow-400 border-b-2 border-yellow-500' : 'text-slate-500 hover:text-slate-300'}`}
                >
                    Playbook (対応マニュアル) {backdoorActive && '⚠'}
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

            {/* ─── Playbook (対応マニュアル) パネル ─────────────────────────── */}
            {panel === 'playbook' && (
                <div className="flex-1 overflow-y-auto p-6 space-y-6" style={{ minHeight: 'calc(100vh - 110px)' }}>
                    <div>
                        <h2 className="text-yellow-400 font-bold text-lg mb-2">📋 セキュリティインシデント対応 Playbook</h2>
                        <p className="text-slate-400 text-sm">
                            インシデント発生時は、以下のステップに従ってターミナルから各種コマンドを実行し、脅威を特定・無効化してください。<br />
                            <span className="text-red-400">※ ボタンによるショートカットはありません。すべての操作はTerminalで行います。</span>
                        </p>
                    </div>

                    <div className="space-y-4">
                        {/* Step 1: ログの調査 */}
                        <div className="p-4 border border-slate-700 rounded bg-slate-900/50">
                            <h3 className="text-blue-400 font-bold mb-2">Step 1: 攻撃の種類とIPの特定 (トリアージ)</h3>
                            <p className="text-slate-300 text-xs mb-3">
                                サーバー内で何が起きているか、ログファイルや現在の接続状況から調査します。
                            </p>
                            <ul className="text-xs text-slate-400 space-y-2 list-disc pl-5">
                                <li><strong>SSHログイン試行の確認:</strong><br /><code className="text-green-400 bg-slate-800 px-1 py-0.5 rounded">tail /var/log/auth.log</code><br />(大量のFailed passwordがないか確認)</li>
                                <li><strong>Webサーバー(HTTP)への攻撃確認:</strong><br /><code className="text-green-400 bg-slate-800 px-1 py-0.5 rounded">tail /var/log/nginx/access.log</code><br />(SQLiやRCE、大量のDDoSアクセス等の不審なURLリクエストを探す)</li>
                                <li><strong>システムエラーや不正プロセスの痕跡:</strong><br /><code className="text-green-400 bg-slate-800 px-1 py-0.5 rounded">tail /var/log/syslog</code> または <code className="text-green-400 bg-slate-800 px-1 py-0.5 rounded">tail /var/log/vsftpd.log</code><br />(FTPやランサムウェア等の特異な活動ログ)</li>
                                <li><strong>現在のアクティブなネットワーク接続:</strong><br /><code className="text-green-400 bg-slate-800 px-1 py-0.5 rounded">netstat -an</code><br />(外部からの不審な確立済みセッションや大量のSYN_RECVを探す)</li>
                            </ul>
                        </div>

                        {/* Step 2: 攻撃元のブロック */}
                        <div className="p-4 border border-slate-700 rounded bg-slate-900/50">
                            <h3 className="text-blue-400 font-bold mb-2">Step 2: 攻撃元IPのブロック (封じ込め)</h3>
                            <p className="text-slate-300 text-xs mb-3">
                                ログから特定した攻撃者のIPアドレスをファイアウォールで遮断し、攻撃の継続を防ぎます。
                            </p>
                            <div className="text-xs text-slate-400">
                                実行コマンド:<br />
                                <code className="text-green-400 bg-slate-800 px-2 py-1 rounded inline-block mt-1">iptables -A INPUT -s &lt;攻撃者のIPアドレス&gt; -j DROP</code>
                            </div>
                        </div>

                        {/* Step 3: 不正プロセスの停止・復旧 */}
                        <div className="p-4 border border-slate-700 rounded bg-slate-900/50">
                            <h3 className="text-blue-400 font-bold mb-2">Step 3: 不正プロセスの特定と排除 (根絶)</h3>
                            <p className="text-slate-300 text-xs mb-3">
                                攻撃者が既にバックドア(nc)を仕掛けたり、ランサムウェア(暗号化ツール)を実行している可能性があります。<br />
                                プロセス一覧から不正なPIDを特定し、強制終了させます。
                            </p>
                            <ul className="text-xs text-slate-400 space-y-2 list-disc pl-5">
                                <li><strong>プロセスの確認:</strong><br /><code className="text-green-400 bg-slate-800 px-1 py-0.5 rounded">ps aux</code><br />(不審なスクリプト `bd.sh`、`nc`、`encrypt` 等がないか確認)</li>
                                <li><strong>プロセスの強制終了:</strong><br /><code className="text-green-400 bg-slate-800 px-1 py-0.5 rounded">kill -9 &lt;PID&gt;</code></li>
                                <li><strong>攻撃者が作成した不審ファイルの削除:</strong><br /><code className="text-green-400 bg-slate-800 px-1 py-0.5 rounded">rm -rf /tmp/.hidden</code> や <code className="text-green-400 bg-slate-800 px-1 py-0.5 rounded">rm /var/www/html/webshell.php</code></li>
                            </ul>
                            <p className="text-xs text-yellow-400 mt-3">
                                ※ 基本的な攻撃（SSH総当たり、SQLi、RCEなど）は、上記のStep1〜3で隔離・排除が完了します。
                            </p>
                        </div>

                        {/* Step 4: 高度なインフラリソースとカーネルの調査 */}
                        <div className="p-4 border border-indigo-900 rounded bg-indigo-950/30">
                            <h3 className="text-indigo-400 font-bold mb-2">Step 4: インフラリソースとカーネルの調査 (Advanced)</h3>
                            <p className="text-slate-300 text-xs mb-3">
                                DDoS(SYN Flood)やリソース枯渇(Fork Bomb, Slowloris)攻撃では、OSやカーネルレベルの確認・防御が必要です。
                            </p>
                            <ul className="text-xs text-slate-400 space-y-2 list-disc pl-5">
                                <li><strong>現在のアクティブなソケット・接続状態:</strong><br /><code className="text-green-400 bg-slate-800 px-1 py-0.5 rounded">ss -s</code><br />(TCPのSYN-RECVやESTABが異常に多くないか確認)</li>
                                <li><strong>カーネルメッセージ(OOMやSYN flood警告など):</strong><br /><code className="text-green-400 bg-slate-800 px-1 py-0.5 rounded">dmesg | tail</code></li>
                                <li><strong>メモリ枯渇状態の確認:</strong><br /><code className="text-green-400 bg-slate-800 px-1 py-0.5 rounded">free -m</code></li>
                                <li><strong>ファイルディスクリプタ(FD)占有状況:</strong><br /><code className="text-green-400 bg-slate-800 px-1 py-0.5 rounded">lsof -i :80</code></li>
                                <li><strong>カーネルパラメータの変更 (SYN Flood防御):</strong><br /><code className="text-green-400 bg-slate-800 px-1 py-0.5 rounded">sysctl -w net.ipv4.tcp_syncookies=1</code></li>
                            </ul>
                        </div>

                        {/* Step 5: 永続化（Persistence）の排除 */}
                        <div className="p-4 border border-indigo-900 rounded bg-indigo-950/30">
                            <h3 className="text-indigo-400 font-bold mb-2">Step 5: 永続化機能の排除 (Advanced)</h3>
                            <p className="text-slate-300 text-xs mb-3">
                                攻撃者がバックドアを自動起動(Cron)させたり、公開鍵(SSH)を設置したり、カーネルモジュール(LKM)として潜伏している場合の調査と排除です。
                            </p>
                            <ul className="text-xs text-slate-400 space-y-2 list-disc pl-5">
                                <li><strong>不正な定期実行ジョブの確認・削除:</strong><br /><code className="text-green-400 bg-slate-800 px-1 py-0.5 rounded">crontab -l</code><br /><code className="text-green-400 bg-slate-800 px-1 py-0.5 rounded">rm /etc/cron.d/malicious_job</code></li>
                                <li><strong>不正なSSH公開鍵の確認・削除:</strong><br /><code className="text-green-400 bg-slate-800 px-1 py-0.5 rounded">cat ~/.ssh/authorized_keys</code><br /><code className="text-green-400 bg-slate-800 px-1 py-0.5 rounded">rm ~/.ssh/authorized_keys</code></li>
                                <li><strong>不正なカーネルモジュール(Rootkit)の確認・排除:</strong><br /><code className="text-green-400 bg-slate-800 px-1 py-0.5 rounded">lsmod</code><br /><code className="text-green-400 bg-slate-800 px-1 py-0.5 rounded">rmmod &lt;モジュール名&gt;</code></li>
                            </ul>
                            <p className="text-xs text-yellow-400 mt-3">
                                ※ 該当する脅威をすべて取り除くと、自動的に「インシデント解決 (Game Clear)」となります。
                            </p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
