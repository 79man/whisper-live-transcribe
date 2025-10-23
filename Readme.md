# Whisper Live Transcribe Browser Extension

Effortless in-browser speech-to-text powered by OpenAI Whisper.  
Supports both **batch mode** (full audio export & transcription) and **streaming mode** (incremental, chunked transcription) using MediaRecorder.

## Features

- **Batch Mode:**  
  - Records full browser/session audio  
  - Transcribes the entire file after recording stops  
  - Optimized for accuracy and long recordings

- **Streaming Mode:**  
  - Captures short audio segments every N seconds  
  - Decodes only new audio for incremental, near-real-time transcription  
  - No duplicate text; skips already transcribed samples
  - User can monitor transcription progress live

- **Model Selection:**  
  - Choose between Whisper Tiny, Base, and Small (English-only or multilingual)
  - Reload and switch models on demand
  - GPU/WebGPU device detection and selection

- **Chrome Extension Ready:**  
  - Uses offscreen document for audio capture and PCM extraction  
  - Communicates state, progress, and results to UI via runtime messaging

- **Robust Audio Processing:**  
  - Safely decodes WebM/Opus blobs to PCM
  - Accurate sample skipping logic for streaming mode
  - Automatic resampling to 16,000 Hz for Whisper compatibility

---

## Getting Started

### 1. **Clone the Repo**
```
git clone https://github.com/79man/whisper-live-transcribe.git
cd whisper-dual-mode
```

### 2. **Dependencies**

This is an unpackaged chrome browser extension — just load into Chrome using Dev Mode.  
Uses:

- [@xenova/transformers.js](https://github.com/xenova/transformers.js)
- [OpenAI Whisper Models](https://huggingface.co/Xenova)

### 3. **Load the Extension**

- Open Chrome > Extensions > Developer Mode
- Click "Load Unpacked"
- Select your `whisper-live-transcribe` folder

### 4. **Usage**

- Click the extension in your browser to open the side panel.
- Select model and transcription mode (batch or streaming)
- Start recording audio from your browser tab
- View transcripts as they’re processed

---

## Folder Structure
```
offscreen/ 
    # Manages audio capture, decoding, and messaging
    offscreen.js 
    offscreen.html

styles/
    styles.css

ui/ 
    # Extension UI and status display
    sidepanel.html
    sidepanel.js

workers/
    transcription-worker.js # Handles Whisper inference and progress

```


---

## Roadmap

- ✔️ Batch & streaming transcription via MediaRecorder
- ⏳ Ultra-low-latency **streaming mode using AudioWorklet** (coming soon)
- ⏳ VAD, silence detection, speaker segmentation
- ⏳ Export as .txt, .vtt, .srt
- ⏳ Multiple language recognition
- ⏳ Edge browser support

---

## Contributing

Pull requests, feature suggestions, and bug reports are always welcome!

---

## License

[MIT](LICENSE)

---

## Credits

Powered by [OpenAI Whisper](https://github.com/openai/whisper) and [Transformers.js by Xenova](https://github.com/xenova/transformers.js).
