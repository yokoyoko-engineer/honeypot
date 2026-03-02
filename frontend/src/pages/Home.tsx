import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Socket } from 'socket.io-client';

interface RoomStatus {
    id: string;
    hasAttacker: boolean;
    hasDefender: boolean;
    phase: string;
}

interface HomeProps {
    connected: boolean;
    socket: Socket | null;
}

export function Home({ connected, socket }: HomeProps) {
    const navigate = useNavigate();
    const [selectedRole, setSelectedRole] = useState<'ATTACKER' | 'DEFENDER' | null>(null);
    const [rooms, setRooms] = useState<RoomStatus[]>([]);

    useEffect(() => {
        if (!socket) return;

        socket.emit('get_rooms');

        socket.on('rooms_status', (data: RoomStatus[]) => {
            setRooms(data);
        });

        return () => {
            socket.off('rooms_status');
        };
    }, [socket]);

    const handleRoomSelect = (roomId: string) => {
        if (selectedRole === 'ATTACKER') {
            navigate(`/attacker?room=${roomId}`);
        } else if (selectedRole === 'DEFENDER') {
            navigate(`/defender?room=${roomId}`);
        }
    };

    return (
        <div className="min-h-screen bg-black text-slate-300 font-mono flex flex-col items-center justify-center p-8">
            {/* タイトル */}
            <div className="text-center mb-12">
                <div className="text-6xl mb-4">🛡️</div>
                <h1 className="text-3xl font-bold text-green-400 mb-2">Security Sandbox</h1>
                <p className="text-slate-500 text-sm">サイバーセキュリティ攻撃・防御 研修シミュレーター</p>
                <div className={`mt-3 text-xs px-3 py-1 rounded-full inline-block ${connected ? 'bg-green-950 text-green-400 border border-green-800' : 'bg-red-950 text-red-400 border border-red-800'}`}>
                    ● {connected ? 'サーバー接続中' : 'サーバーに接続できません'}
                </div>
            </div>

            {/* シナリオ説明 */}
            <div className="w-full max-w-2xl mb-10 p-5 border border-slate-800 rounded-lg bg-slate-900/50 text-sm space-y-3">
                <h2 className="text-yellow-400 font-bold flex items-center gap-2">
                    📋 シナリオ概要
                </h2>
                <p className="text-slate-400">
                    あなたは社内サーバー <code className="text-green-400">192.168.1.100</code> を守るセキュリティ担当者です。
                    外部の攻撃者がSSHブルートフォース攻撃を仕掛けてきています。
                </p>
                <div className="border-l-2 border-yellow-700 pl-3 space-y-1 text-slate-400">
                    <p>🔴 <strong className="text-red-400">攻撃側</strong>: ブルートフォースで認証情報を入手 → 自動ログイン → DBを奪取 → バックドアを仕掛ける</p>
                    <p>🔵 <strong className="text-blue-400">防御側</strong>: アラートを受信 → ログを解析 → 攻撃者IPを特定しブロック → 被害範囲を調査 → バックドアを遮断</p>
                </div>
                <div className="text-xs text-slate-600 pt-1">
                    ※ 防御側は <code>tail -f /var/log/auth.log</code> 等の Linuxコマンドを駆使して対応します
                </div>
            </div>

            {/* ロール選択 または ルーム選択 */}
            {!selectedRole ? (
                <div className="w-full max-w-2xl grid grid-cols-2 gap-4">
                    <button
                        onClick={() => setSelectedRole('ATTACKER')}
                        disabled={!connected}
                        className="group p-6 border border-red-900/50 rounded-lg bg-red-950/10 hover:bg-red-950/30 hover:border-red-700 transition-all disabled:opacity-40 disabled:cursor-not-allowed text-left"
                    >
                        <div className="text-3xl mb-3">⚔️</div>
                        <div className="text-red-400 font-bold text-lg mb-1">攻撃側</div>
                        <div className="text-slate-500 text-xs leading-relaxed">
                            ブルートフォース攻撃を実行し、認証情報を奪取後、DBを盗みバックドアを構築する
                        </div>
                    </button>

                    <button
                        onClick={() => setSelectedRole('DEFENDER')}
                        disabled={!connected}
                        className="group p-6 border border-blue-900/50 rounded-lg bg-blue-950/10 hover:bg-blue-950/30 hover:border-blue-700 transition-all disabled:opacity-40 disabled:cursor-not-allowed text-left"
                    >
                        <div className="text-3xl mb-3">🛡️</div>
                        <div className="text-blue-400 font-bold text-lg mb-1">防御側</div>
                        <div className="text-slate-500 text-xs leading-relaxed">
                            ログを解析し攻撃IPを特定・ブロック、被害範囲を調査してバックドアを遮断する
                        </div>
                    </button>
                </div>
            ) : (
                <div className="w-full max-w-2xl bg-slate-900/50 border border-slate-800 rounded-lg p-6">
                    <div className="flex items-center justify-between mb-6">
                        <h2 className="text-lg font-bold flex items-center gap-2">
                            {selectedRole === 'ATTACKER' ? '⚔️ 攻撃側' : '🛡️ 防御側'} として参加するルームを選択
                        </h2>
                        <button onClick={() => setSelectedRole(null)} className="text-xs text-slate-500 hover:text-white underline">
                            役割を選び直す
                        </button>
                    </div>

                    <div className="grid gap-3">
                        {rooms.map(room => {
                            const isFull = (selectedRole === 'ATTACKER' && room.hasAttacker) ||
                                (selectedRole === 'DEFENDER' && room.hasDefender);
                            return (
                                <button
                                    key={room.id}
                                    onClick={() => handleRoomSelect(room.id)}
                                    disabled={isFull}
                                    className={`flex items-center justify-between p-4 rounded border transition-colors ${isFull
                                            ? 'bg-slate-900 border-slate-800 opacity-50 cursor-not-allowed'
                                            : selectedRole === 'ATTACKER'
                                                ? 'bg-red-950/10 border-red-900/30 hover:bg-red-950/30 hover:border-red-500'
                                                : 'bg-blue-950/10 border-blue-900/30 hover:bg-blue-950/30 hover:border-blue-500'
                                        }`}
                                >
                                    <div className="font-bold text-slate-300">{room.id}</div>
                                    <div className="flex gap-4 text-xs font-mono">
                                        <div className={room.hasAttacker ? 'text-red-400' : 'text-slate-600'}>
                                            Attacker: {room.hasAttacker ? 'Waiting' : 'Empty'}
                                        </div>
                                        <div className={room.hasDefender ? 'text-blue-400' : 'text-slate-600'}>
                                            Defender: {room.hasDefender ? 'Waiting' : 'Empty'}
                                        </div>
                                    </div>
                                    {isFull && <div className="text-xs text-slate-500 ml-4">満室</div>}
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            <div className="mt-8 text-xs text-slate-700">
                Security Sandbox v2.0 — 研修目的シミュレーション
            </div>
        </div>
    );
}
