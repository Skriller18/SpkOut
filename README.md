# SpkOut - Speech-to-Text Sync

Simple web app for recording speech on your phone and viewing the transcript on any device using a shared session link.

## Features
- Record audio on phone (or any device with a mic)
- Uses browser's built-in Web Speech API for ASR (no backend transcription needed)
- Share a session link — same transcript appears everywhere
- Real-time sync via WebSocket
- No login, no accounts — just open the link

## How to Use
1. Open the app on your phone
2. Click "New Session" or enter any session ID
3. Start recording — speech is transcribed live
4. Open the same session link on your laptop
5. See the transcript appear in real-time

## Tech Stack
- HTML/CSS/JS (vanilla)
- Express.js backend
- WebSocket for real-time sync
- Web Speech API for ASR
