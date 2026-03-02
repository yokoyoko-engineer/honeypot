import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';
import { Home } from './pages/Home';
import { Attacker } from './pages/Attacker';
import { Defender } from './pages/Defender';

// nginx リバースプロキシ経由でアクセスするため、
// 同一オリジン（window.location.origin）に接続する
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || window.location.origin;

function App() {
    const [socket, setSocket] = useState<Socket | null>(null);
    const [connected, setConnected] = useState(false);

    useEffect(() => {
        const newSocket = io(BACKEND_URL);
        setSocket(newSocket);

        newSocket.on('connect', () => {
            setConnected(true);
            console.log('Connected to backend');
        });

        newSocket.on('disconnect', () => {
            setConnected(false);
            console.log('Disconnected from backend');
        });

        return () => {
            newSocket.close();
        };
    }, []);

    return (
        <BrowserRouter>
            <Routes>
                <Route path="/" element={<Home connected={connected} />} />
                <Route path="/attacker" element={<Attacker socket={socket} />} />
                <Route path="/defender" element={<Defender socket={socket} />} />
            </Routes>
        </BrowserRouter>
    );
}

export default App;
