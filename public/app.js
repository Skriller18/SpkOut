// SpkOut - Simple Voice to Text Chat
// Record voice note → transcribe → show like chat

let ws = null;
let sessionId = null;
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let transcripts = [];
let recognition = null;

// Generate a random session ID
function generateSessionId() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Get session from URL
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

// Connect to WebSocket
function connectSession(sid) {
    sessionId = sid;
    
    document.getElementById('sessionInput').value = sid;
    document.getElementById('shareSection').style.display = 'flex';
    document.getElementById('shareUrl').value = window.location.href;
    
    transcripts = [];
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
            renderTranscripts();
        } else if (data.type === 'clear') {
            transcripts = [];
            renderTranscripts();
        }
    };
    
    ws.onclose = () => {
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

// Start recording voice note
async function startRecording() {
    if (!sessionId) {
        alert('Please join or create a session first!');
        return;
    }
    
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                sampleRate: 44100
            }
        });
        
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
            
            // Stop all tracks
            stream.getTracks().forEach(track => track.stop());
            
            if (audioBlob.size > 1000) {
                // Add audio to chat
                addAudioToChat(audioBlob);
            }
            
            updateUIState(false);
        };
        
        // Start recording
        mediaRecorder.start();
        
        // Start speech recognition simultaneously
        startSpeechRecognition();
        
        isRecording = true;
        updateUIState(true);
        
    } catch (err) {
        console.error('Failed to start recording:', err);
        alert('Microphone access denied. Please allow microphone permission.');
    }
}

// Start speech recognition
function startSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
        console.warn('Speech Recognition API not supported in this browser');
        showToast('Speech recognition not supported');
        return;
    }
    
    console.log('Starting speech recognition...');
    
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    
    let finalTranscript = '';
    let hasReceivedResult = false;
    
    recognition.onstart = () => {
        console.log('Speech recognition started');
    };
    
    recognition.onresult = (event) => {
        hasReceivedResult = true;
        let interimTranscript = '';
        
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
                finalTranscript += transcript + ' ';
                console.log('Final transcript part:', transcript);
            } else {
                interimTranscript += transcript;
            }
        }
        
        console.log('Interim:', interimTranscript);
        console.log('Final so far:', finalTranscript);
        
        // Show interim text
        if (interimTranscript || finalTranscript) {
            showInterimText(finalTranscript + interimTranscript);
        }
    };
    
    recognition.onend = () => {
        console.log('Speech recognition ended. Final transcript:', finalTranscript);
        
        // When recording stops, send the final transcript
        if (finalTranscript.trim()) {
            sendTranscript(finalTranscript.trim());
            showToast('Transcript added!');
        } else if (!hasReceivedResult) {
            showToast('No speech detected');
        }
        
        clearInterimText();
    };
    
    recognition.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        showToast('Error: ' + event.error);
    };
    
    try {
        recognition.start();
        console.log('Speech recognition.start() called successfully');
    } catch (e) {
        console.error('Failed to start recognition:', e);
        showToast('Failed to start speech recognition');
    }
}

// Show interim text
function showInterimText(text) {
    let interimEl = document.getElementById('interimText');
    if (!interimEl) {
        interimEl = document.createElement('div');
        interimEl.id = 'interimText';
        interimEl.className = 'chat-item text-item interim';
        interimEl.innerHTML = `
            <div class="chat-bubble text-bubble" style="opacity: 0.7; border-left-color: #ff9500;">
                ${escapeHtml(text)}
            </div>
            <div class="chat-time" style="color: #ff9500;">Transcribing...</div>
        `;
        document.getElementById('transcripts').appendChild(interimEl);
    } else {
        interimEl.querySelector('.text-bubble').textContent = text;
    }
    
    // Scroll to bottom
    const container = document.getElementById('transcripts');
    container.scrollTop = container.scrollHeight;
}

// Clear interim text
function clearInterimText() {
    const interimEl = document.getElementById('interimText');
    if (interimEl) {
        interimEl.remove();
    }
}

// Stop recording
function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    }
    
    if (recognition) {
        recognition.stop();
    }
    
    isRecording = false;
}

// Toggle recording
function toggleRecording() {
    if (isRecording) {
        stopRecording();
    } else {
        startRecording();
    }
}

// Add audio to chat UI
function addAudioToChat(audioBlob) {
    const audioUrl = URL.createObjectURL(audioBlob);
    const entry = {
        type: 'audio',
        audioUrl: audioUrl,
        timestamp: new Date().toISOString(),
        id: Date.now()
    };
    transcripts.push(entry);
    renderTranscripts();
}

// Send transcript to server
function sendTranscript(text) {
    if (!text) return;
    
    const entry = {
        type: 'transcript',
        text: text,
        timestamp: new Date().toISOString()
    };
    
    // Add locally first
    transcripts.push(entry);
    renderTranscripts();
    
    // Send via WebSocket
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(entry));
    }
}

// Update UI state
function updateUIState(recording) {
    const recordBtn = document.getElementById('recordBtn');
    const status = document.getElementById('status');
    
    if (recording) {
        recordBtn.classList.add('recording');
        status.classList.add('active');
        recordBtn.textContent = '⏹️';
    } else {
        recordBtn.classList.remove('recording');
        status.classList.remove('active');
        recordBtn.textContent = '🎤';
    }
}

// Render transcripts (chat style)
function renderTranscripts() {
    const container = document.getElementById('transcripts');
    
    if (transcripts.length === 0) {
        container.innerHTML = `
            <div class="empty-state" id="emptyState">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z"/>
                </svg>
                <p>Join a session and record a voice note</p>
            </div>
        `;
        return;
    }
    
    let html = '';
    
    transcripts.forEach((item) => {
        if (item.type === 'audio') {
            html += `
                <div class="chat-item audio-item">
                    <div class="chat-bubble audio-bubble">
                        <audio controls src="${item.audioUrl}"></audio>
                    </div>
                    <div class="chat-time">${formatTime(item.timestamp)}</div>
                </div>
            `;
        } else {
            html += `
                <div class="chat-item text-item">
                    <div class="chat-bubble text-bubble">
                        ${escapeHtml(item.text)}
                    </div>
                    <div class="chat-time">${formatTime(item.timestamp)}</div>
                </div>
            `;
        }
    });
    
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
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Copy all text
function copyAllText() {
    if (transcripts.length === 0) {
        alert('No text to copy yet!');
        return;
    }
    
    const textItems = transcripts.filter(t => t.type === 'transcript' || t.text);
    const fullText = textItems.map(t => t.text).join('\n\n');
    
    if (!fullText) {
        alert('No transcripts yet!');
        return;
    }
    
    navigator.clipboard.writeText(fullText).then(() => {
        showToast('📋 Copied all text!');
    });
}

// Download text
function downloadText() {
    const textItems = transcripts.filter(t => t.type === 'transcript' || t.text);
    if (textItems.length === 0) {
        alert('No text to download yet!');
        return;
    }
    
    const fullText = textItems.map(t => {
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

// Clear all
function clearTranscripts() {
    if (transcripts.length === 0) return;
    
    if (!confirm('Clear all messages? This cannot be undone.')) return;
    
    transcripts = [];
    renderTranscripts();
    
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'clear' }));
    }
    
    showToast('🗑️ Cleared!');
}

// Show toast
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

// Handle Enter key
document.getElementById('sessionInput')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') joinSession();
});