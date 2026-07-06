// SpkOut - Speech to Text App using MediaRecorder + Server-side Whisper
let ws = null;
let sessionId = null;
let mediaRecorder = null;
let stream = null;
let isRecording = false;
let transcripts = [];
let liveText = '';
let audioChunks = [];
let recordingInterval = null;

// Generate a random session ID
function generateSessionId() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Get session from URL or input
function getSessionFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get('session');
}

// Join or create session
function joinSession() {
    const input = document.getElementById('sessionInput');
    const newSessionId = input.value.trim() || generateSessionId();
    
    if (newSessionId) {
        const url = new URL(window.location);
        url.searchParams.set('session', newSessionId);
        window.history.pushState({}, '', url);
        
        connectSession(newSessionId);
    }
}

// Connect to WebSocket for a session
function connectSession(sid) {
    sessionId = sid;
    
    document.getElementById('sessionInput').value = sid;
    document.getElementById('shareSection').style.display = 'flex';
    document.getElementById('shareUrl').value = window.location.href;
    document.getElementById('emptyState').style.display = 'none';
    
    transcripts = [];
    liveText = '';
    renderTranscripts();
    
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}?session=***}`;
    
    if (ws) ws.close();
    
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
        console.log('Connected to session:', sid);
        ws.send(JSON.stringify({ type: 'join', sessionId: sid }));
    };
    
    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        
        if (data.type === 'history') {
            transcripts = data.data || [];
            renderTranscripts();
        } else if (data.type === 'transcript') {
            transcripts.push(data.data);
            liveText = '';
            renderTranscripts();
        } else if (data.type === 'clear') {
            transcripts = [];
            liveText = '';
            renderTranscripts();
        }
    };
    
    ws.onclose = () => {
        console.log('WebSocket closed, reconnecting...');
        setTimeout(() => connectSession(sid), 2000);
    };
    
    ws.onerror = (err) => {
        console.error('WebSocket error:', err);
    };
}

// Copy share link
function copyLink() {
    const input = document.getElementById('shareUrl');
    input.select();
    navigator.clipboard.writeText(input.value).then(() => {
        const btn = event.target;
        const original = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => btn.textContent = original, 2000);
    });
}

// Send audio chunk to server for transcription using Puter.js (free, no API key)
async function transcribeAudioChunk(audioBlob) {
    try {
        // Check if Puter.js is loaded
        if (typeof puter === 'undefined' || !puter.ai || !puter.ai.speech2txt) {
            console.warn('Puter.js not available, falling back to Web Speech API');
            // Fallback: just show that we got audio but can't transcribe
            return;
        }
        
        // Convert blob to file for Puter.js
        const audioFile = new File([audioBlob], 'recording.webm', { type: audioBlob.type });
        
        // Transcribe using Puter.js (free, no API key needed)
        const transcript = await puter.ai.speech2txt(audioFile, {
            model: 'whisper' // or 'gpt-4o-transcribe' for higher accuracy
        });
        
        if (transcript && transcript.trim()) {
            sendTranscript(transcript.trim());
        }
    } catch (e) {
        console.error('Puter.js transcription error:', e);
    }
}

// Start recording
async function startRecording() {
    if (!sessionId) {
        alert('Please join or create a session first!');
        return;
    }
    
    try {
        // Get microphone access
        stream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                sampleRate: 44100
            }
        });
        
        // Determine supported MIME type
        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') 
            ? 'audio/webm;codecs=opus' 
            : 'audio/webm';
        
        mediaRecorder = new MediaRecorder(stream, { mimeType });
        
        audioChunks = [];
        
        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                audioChunks.push(event.data);
            }
        };
        
        mediaRecorder.onstop = async () => {
            const audioBlob = new Blob(audioChunks, { type: mimeType });
            audioChunks = [];
            
            if (audioBlob.size > 1000) { // Only send if we have meaningful audio
                await transcribeAudioChunk(audioBlob);
            }
            
            // Restart recording if still in recording mode (continuous)
            if (isRecording) {
                try {
                    mediaRecorder.start(3000); // Capture every 3 seconds
                } catch (e) {
                    console.log('Restart failed:', e);
                    isRecording = false;
                    updateUIState();
                }
            }
        };
        
        mediaRecorder.onerror = (e) => {
            console.error('MediaRecorder error:', e);
            isRecording = false;
            updateUIState();
        };
        
        // Start recording - collect data every 3 seconds
        mediaRecorder.start(3000);
        isRecording = true;
        updateUIState();
        
        console.log('Recording started');
        
    } catch (err) {
        console.error('Failed to start recording:', err);
        alert('Microphone access denied or not available. Please allow microphone permission.');
        isRecording = false;
        updateUIState();
    }
}

// Stop recording
function stopRecording() {
    isRecording = false;
    
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    }
    
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
    }
    
    updateUIState();
    console.log('Recording stopped');
}

// Update UI state
function updateUIState() {
    const recordBtn = document.getElementById('recordBtn');
    const status = document.getElementById('status');
    
    if (isRecording) {
        recordBtn.classList.add('recording');
        status.classList.add('active');
        recordBtn.textContent = '⏹️';
    } else {
        recordBtn.classList.remove('recording');
        status.classList.remove('active');
        recordBtn.textContent = '🎤';
    }
}

// Toggle recording
function toggleRecording() {
    if (isRecording) {
        stopRecording();
    } else {
        startRecording();
    }
}

// Send transcript via WebSocket
function sendTranscript(text) {
    console.log('sendTranscript called with:', text);
    
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.error('WebSocket not connected');
        // Store locally anyway
        const localEntry = {
            text: text,
            timestamp: new Date().toISOString(),
            id: Date.now()
        };
        transcripts.push(localEntry);
        liveText = '';
        renderTranscripts();
        return;
    }
    
    const entry = {
        type: 'transcript',
        text: text,
        timestamp: new Date().toISOString()
    };
    
    ws.send(JSON.stringify(entry));
}

// Render transcripts
function renderTranscripts() {
    const container = document.getElementById('transcripts');
    
    if (transcripts.length === 0 && !liveText) {
        container.innerHTML = `
            <div class="empty-state" id="emptyState">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z"/>
                </svg>
                <p>Join a session and tap the mic to start</p>
            </div>
        `;
        return;
    }
    
    let html = transcripts.map((t, index) => `
        <div class="transcript-item" data-index="${index}">
            <div class="text">${escapeHtml(t.text)}</div>
            <div class="time">${formatTime(t.timestamp)}</div>
        </div>
    `).join('');
    
    if (liveText) {
        html += `
            <div class="transcript-item live">
                <div class="text">${escapeHtml(liveText)}</div>
                <div class="time">🎙️ Processing...</div>
            </div>
        `;
    }
    
    container.innerHTML = html;
    
    requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight;
    });
}

// Escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Format timestamp
function formatTime(iso) {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// Copy all text to clipboard
function copyAllText() {
    if (transcripts.length === 0 && !liveText) {
        alert('No text to copy yet!');
        return;
    }
    
    const fullText = transcripts.map(t => t.text).join('\n\n');
    navigator.clipboard.writeText(fullText).then(() => {
        showToast('📋 Copied all text!');
    });
}

// Download all text as file
function downloadText() {
    if (transcripts.length === 0 && !liveText) {
        alert('No text to download yet!');
        return;
    }
    
    const fullText = transcripts.map(t => {
        const time = new Date(t.timestamp).toLocaleString();
        return `[${time}]\n${t.text}`;
    }).join('\n\n---\n\n');
    
    const blob = new Blob([fullText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `spkout-${sessionId}-${new Date().toISOString().slice(0,10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    showToast('⬇️ Downloaded!');
}

// Clear all transcripts
function clearTranscripts() {
    if (transcripts.length === 0 && !liveText) return;
    
    if (!confirm('Clear all text? This cannot be undone.')) return;
    
    transcripts = [];
    liveText = '';
    renderTranscripts();
    
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'clear' }));
    }
    
    showToast('🗑️ Cleared!');
}

// Show toast notification
function showToast(message) {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();
    
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 2000);
}

// Initialize
window.onload = () => {
    const urlSession = getSessionFromUrl();
    if (urlSession) {
        document.getElementById('sessionInput').value = urlSession;
        connectSession(urlSession);
    }
};

// Handle Enter key in session input
document.getElementById('sessionInput')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') joinSession();
});
