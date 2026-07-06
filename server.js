const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const { Groq } = require('groq-sdk');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Initialize Groq client
const groq = new Groq({ 
    apiKey: process.env.GROQ_API_KEY
});

// Store sessions in memory
const sessions = new Map();

// Temporary directory for audio chunks
const TEMP_DIR = path.join(__dirname, 'temp_audio');
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

app.use(express.static('public'));
app.use(express.json({ limit: '50mb' }));

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

// Transcribe audio using Groq Cloud Whisper
app.post('/api/transcribe', async (req, res) => {
    try {
        const { audioData, sessionId } = req.body;
        
        if (!audioData) {
            return res.status(400).json({ error: 'No audio data provided' });
        }

        // Convert base64 to buffer
        const audioBuffer = Buffer.from(audioData, 'base64');
        
        // Save to temporary file
        const tempFile = path.join(TEMP_DIR, `chunk_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.webm`);
        fs.writeFileSync(tempFile, audioBuffer);
        
        let transcriptText = '';
        
        try {
            // Create file-like object for Groq
            const file = await Groq.toFile(audioBuffer, "audio.webm", { type: "audio/webm" });
            
            // Transcribe using Groq Whisper
            const transcription = await groq.audio.transcriptions.create({
                file: file,
                model: "whisper-large-v3",
            });
            
            transcriptText = transcription.text || '';
            console.log('Transcription successful:', transcriptText);
            
        } catch (groqError) {
            console.error('Groq transcription error:', groqError.message);
            transcriptText = '';
        }
        
        // Clean up temp file
        try { fs.unlinkSync(tempFile); } catch (e) { /* ignore */ }
        
        res.json({ 
            success: true, 
            transcript: transcriptText,
            sessionId
        });
        
    } catch (error) {
        console.error('Transcription error:', error);
        res.status(500).json({ error: 'Transcription failed', details: error.message });
    }
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

// Cleanup temp files periodically
setInterval(() => {
    try {
        const files = fs.readdirSync(TEMP_DIR);
        const now = Date.now();
        files.forEach(file => {
            const filePath = path.join(TEMP_DIR, file);
            const stats = fs.statSync(filePath);
            if (now - stats.mtime.getTime() > 5 * 60 * 1000) {
                fs.unlinkSync(filePath);
            }
        });
    } catch (e) {
        console.error('Cleanup error:', e);
    }
}, 60000);

const PORT = process.env.PORT || 3456;
server.listen(PORT, () => {
    console.log(`🎙️  SpkOut running on http://localhost:${PORT}`);
});
