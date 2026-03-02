import { useNavigate } from 'react-router-dom';

interface HomeProps {
    connected: boolean;
}

export function Home({ connected }: HomeProps) {
    const navigate = useNavigate();

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

            {/* ロール選択 */}
            <div className="w-full max-w-2xl grid grid-cols-2 gap-4">
                <button
                    onClick={() => navigate('/attacker')}
                    disabled={!connected}
                    className="group p-6 border border-red-900/50 rounded-lg bg-red-950/10 hover:bg-red-950/30 hover:border-red-700 transition-all disabled:opacity-40 disabled:cursor-not-allowed text-left"
                >
                    <div className="text-3xl mb-3">⚔️</div>
                    <div className="text-red-400 font-bold text-lg mb-1">攻撃側</div>
                    <div className="text-slate-500 text-xs leading-relaxed">
                        ブルートフォース攻撃を実行し、認証情報を奪取後、DBを盗みバックドアを構築する
                    </div>
                    <div className="mt-3 text-xs text-red-700 group-hover:text-red-400 transition-colors">
                        Attacker Terminal →
                    </div>
                </button>

                <button
                    onClick={() => navigate('/defender')}
                    disabled={!connected}
                    className="group p-6 border border-blue-900/50 rounded-lg bg-blue-950/10 hover:bg-blue-950/30 hover:border-blue-700 transition-all disabled:opacity-40 disabled:cursor-not-allowed text-left"
                >
                    <div className="text-3xl mb-3">🛡️</div>
                    <div className="text-blue-400 font-bold text-lg mb-1">防御側</div>
                    <div className="text-slate-500 text-xs leading-relaxed">
                        ログを解析し攻撃IPを特定・ブロック、被害範囲を調査してバックドアを遮断する
                    </div>
                    <div className="mt-3 text-xs text-blue-700 group-hover:text-blue-400 transition-colors">
                        Defender Terminal →
                    </div>
                </button>
            </div>

            <div className="mt-8 text-xs text-slate-700">
                Security Sandbox v2.0 — 研修目的シミュレーション
            </div>
        </div>
    );
}
