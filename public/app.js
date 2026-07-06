// SpkOut - Speech to Text App
let ws = null;
let sessionId = null;
let recognition = null;
let isRecording = false;
let transcripts = [];
let liveText = '';

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
    const wsUrl = `${protocol}//${window.location.host}?session=${sid}`;
    
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

// Setup speech recognition
function setupSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
        alert('Speech recognition not supported. Try Chrome on Android or Safari on iOS.');
        return null;
    }
    
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    
    recognition.onstart = () => {
        isRecording = true;
        document.getElementById('recordBtn').classList.add('recording');
        document.getElementById('status').classList.add('active');
    };
    
    recognition.onend = () => {
        document.getElementById('recordBtn').classList.remove('recording');
        document.getElementById('status').classList.remove('active');
        
        // Mobile browsers stop after each utterance. 
        // We need to restart if user is still in "recording" mode.
        // On Android Chrome, we can restart immediately from onend context.
        // On iOS Safari, we need user to tap again (setTimeout breaks gesture chain).
        if (isRecording) {
            console.log('Recognition ended while isRecording=true, attempting restart...');
            
            // Try immediate restart first (works on Android Chrome)
            try {
                recognition.start();
                console.log('Immediate restart successful');
            } catch (e) {
                console.log('Immediate restart failed:', e.message);
                
                // If immediate fails, try with minimal delay
                // This may work on some Android devices but not iOS
                setTimeout(() => {
                    if (isRecording) {
                        try {
                            recognition.start();
                            console.log('Delayed restart successful');
                        } catch (e2) {
                            console.log('Delayed restart also failed:', e2.message);
                            // Give up - show toast to user
                            isRecording = false;
                            showToast('🎙️ Tap mic to continue recording');
                        }
                    }
                }, 100);
            }
        }
    };
    
    recognition.onresult = (event) => {
        let currentInterim = '';
        let finalText = '';
        
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            
            if (event.results[i].isFinal) {
                finalText += transcript + ' ';
            } else {
                currentInterim += transcript;
            }
        }
        
        // Send final transcript immediately
        if (finalText) {
            const finalTrimmed = finalText.trim();
            if (finalTrimmed) {
                console.log('Sending final transcript:', finalTrimmed);
                sendTranscript(finalTrimmed);
            }
        } else if (currentInterim) {
            // Even if no final text, update live text for display
            console.log('Interim text:', currentInterim);
        }
        
        // Update live text display (final transcripts + current interim)
        const allFinalText = transcripts.map(t => t.text).join(' ');
        liveText = allFinalText + (currentInterim ? ' ' + currentInterim : '');
        
        // Update status popup
        const partialEl = document.getElementById('partialText');
        if (partialEl) {
            partialEl.textContent = currentInterim || allFinalText || 'Listening...';
        }
        
        // Render in main panel
        renderTranscripts();
    };
    
    recognition.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        if (event.error === 'not-allowed') {
            alert('Microphone permission denied. Please allow microphone access in your browser settings.');
            isRecording = false;
        } else if (event.error === 'no-speech') {
            // On mobile, no-speech often means user paused. The recognition will end naturally.
            // We let onend handle the cleanup.
            console.log('No speech detected');
        } else if (event.error === 'network') {
            console.error('Network error during speech recognition');
        } else if (event.error === 'aborted') {
            console.log('Speech recognition aborted (likely manual stop)');
        } else {
            console.error('Unknown speech recognition error:', event.error);
        }
    };
    
    return recognition;
}

// Request microphone permission explicitly (needed for some mobile browsers)
async function requestMicPermission() {
    try {
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            // Stop all tracks immediately — we just needed the permission prompt
            stream.getTracks().forEach(t => t.stop());
        }
    } catch (e) {
        console.warn('getUserMedia permission request failed or not supported:', e);
    }
}

// Keep track of recognition state for mobile workaround
let recognitionRestartAttempts = 0;
const MAX_RESTART_ATTEMPTS = 3;

// Toggle recording
function toggleRecording() {
    if (!sessionId) {
        alert('Please join or create a session first!');
        return;
    }

    if (!recognition) {
        recognition = setupSpeechRecognition();
        if (!recognition) return;
    }

    if (isRecording) {
        // Stop recording
        isRecording = false;
        recognitionRestartAttempts = 0;
        liveText = '';
        try { 
            recognition.stop(); 
        } catch (e) { 
            console.log('Stop error:', e);
        }
        document.getElementById('recordBtn').classList.remove('recording');
        document.getElementById('status').classList.remove('active');
        renderTranscripts();
    } else {
        // Start recording - MUST be called synchronously from a user gesture
        isRecording = true;
        recognitionRestartAttempts = 0;
        try {
            recognition.start();
        } catch (e) {
            console.error('recognition.start() failed:', e);
            isRecording = false;
            
            if (e.message && e.message.includes('already started')) {
                // Already running, just make sure UI is correct
                document.getElementById('recordBtn').classList.add('recording');
                document.getElementById('status').classList.add('active');
            } else if (e.message && e.message.includes('permission')) {
                alert('Microphone permission required. Please allow access and try again.');
            } else {
                alert('Could not start speech recognition. Error: ' + e.message);
            }
        }
    }
}

// Send transcript via WebSocket
function sendTranscript(text) {
    console.log('sendTranscript called with:', text, 'WebSocket state:', ws ? ws.readyState : 'no ws');
    
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.error('WebSocket not connected, transcript not sent:', text);
        // Store locally anyway so user sees it
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
    
    console.log('Sending via WebSocket:', entry);
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
    
    // Build transcript HTML - ensure all transcripts are shown including the most recent
    let html = transcripts.map((t, index) => `
        <div class="transcript-item" data-index="${index}">
            <div class="text">${escapeHtml(t.text)}</div>
            <div class="time">${formatTime(t.timestamp)}</div>
        </div>
    `).join('');
    
    // Add live text at the bottom if exists
    if (liveText) {
        html += `
            <div class="transcript-item live">
                <div class="text">${escapeHtml(liveText)}</div>
                <div class="time">🎙️ Speaking...</div>
            </div>
        `;
    }
    
    container.innerHTML = html;
    
    // Smooth scroll to bottom
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
    
    const fullText = transcripts.map(t => t.text).join('\n\n') + (liveText ? '\n\n[Speaking...] ' + liveText : '');
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
    }).join('\n\n---\n\n') + (liveText ? `\n\n---\n\n[Speaking...]\n${liveText}` : '');
    
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
    toast.style.cssText = `
        position: fixed;
        bottom: 130px;
        left: 50%;
        transform: translateX(-50%);
        background: #1a1a1a;
        color: #fff;
        padding: 12px 24px;
        border-radius: 24px;
        font-size: 14px;
        z-index: 200;
        animation: fadeIn 0.3s ease;
    `;
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
