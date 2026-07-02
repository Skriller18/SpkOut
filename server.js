const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Store sessions in memory (sessionId -> { transcripts: [], clients: Set })
const sessions = new Map();

app.use(express.static('public'));
app.use(express.json());

// Get or create session
app.get('/api/session/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    if (!sessions.has(sessionId)) {
        sessions.set(sessionId, {
            transcripts: [],
            createdAt: new Date().toISOString()
        });
    }
    res.json({ sessionId, transcripts: sessions.get(sessionId).transcripts });
});

// Add transcript to session
app.post('/api/session/:sessionId/transcript', (req, res) => {
    const { sessionId } = req.params;
    const { text, timestamp } = req.body;
    
    if (!sessions.has(sessionId)) {
        sessions.set(sessionId, { transcripts: [], createdAt: new Date().toISOString() });
    }
    
    const session = sessions.get(sessionId);
    const entry = { text, timestamp: timestamp || new Date().toISOString(), id: Date.now() };
    session.transcripts.push(entry);
    
    // Broadcast to all connected clients in this session
    wss.clients.forEach(client => {
        if (client.sessionId === sessionId && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'transcript', data: entry }));
        }
    });
    
    res.json({ success: true, entry });
});

// WebSocket connection handling
wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const sessionId = url.searchParams.get('session');
    
    if (sessionId) {
        ws.sessionId = sessionId;
        
        // Send existing transcripts
        if (sessions.has(sessionId)) {
            ws.send(JSON.stringify({ 
                type: 'history', 
                data: sessions.get(sessionId).transcripts 
            }));
        }
    }
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            if (data.type === 'join' && data.sessionId) {
                ws.sessionId = data.sessionId;
                if (sessions.has(data.sessionId)) {
                    ws.send(JSON.stringify({
                        type: 'history',
                        data: sessions.get(data.sessionId).transcripts
                    }));
                }
            }
            
            if (data.type === 'transcript' && ws.sessionId) {
                const session = sessions.get(ws.sessionId);
                if (session) {
                    const entry = { 
                        text: data.text, 
                        timestamp: data.timestamp || new Date().toISOString(), 
                        id: Date.now() 
                    };
                    session.transcripts.push(entry);
                    
                    // Broadcast to all clients in this session
                    wss.clients.forEach(client => {
                        if (client.sessionId === ws.sessionId && client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify({ type: 'transcript', data: entry }));
                        }
                    });
                }
            }
            
            if (data.type === 'clear' && ws.sessionId) {
                const session = sessions.get(ws.sessionId);
                if (session) {
                    session.transcripts = [];
                    
                    // Broadcast clear to all clients in this session
                    wss.clients.forEach(client => {
                        if (client.sessionId === ws.sessionId && client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify({ type: 'clear' }));
                        }
                    });
                }
            }
        } catch (e) {
            console.error('WebSocket message error:', e);
        }
    });
});

const PORT = process.env.PORT || 3456;
server.listen(PORT, () => {
    console.log(`🎙️  SpkOut running on http://localhost:${PORT}`);
    console.log(`📱 Open on your phone: http://<your-computer-ip>:${PORT}`);
});
