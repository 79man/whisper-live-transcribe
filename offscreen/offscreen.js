console.log("[Offscreen] Script loaded");

let audioContext;
let mediaStream;
let mediaRecorder;
let transcriptionWorker;
let currentTranscriptionMode = "batch";
let recordedChunks = [];
let workerInitialized = false;

console.log("[Offscreen] Creating web worker");
transcriptionWorker = new Worker("../workers/transcription-worker.js", {
  type: "module",
});

transcriptionWorker.onmessage = (event) => {
  console.log("[Offscreen] Worker message received:", event.data);

  const { status, message, file, progress, loaded, total, text, error } =
    event.data;

  if (event.data.type === "debug-log") {
    console.log("[Worker Log]", event.data.message);
    return;
  }

  if (event.data.type === "gpu-status") {
    console.log("[Offscreen] GPU status:", event.data.status);
    chrome.runtime
      .sendMessage({
        type: "gpu-status-update",
        status: event.data.status,
      })
      .catch(() => {});

    try {
      if (chrome && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ gpuStatus: event.data.status });
      }
    } catch (e) {
      console.log("[Offscreen] Could not save GPU status:", e);
    }
    return;
  }

  if (event.data.type === "processing-status") {
    console.log("[Offscreen] Processing status:", event.data.data);
    chrome.runtime
      .sendMessage({
        type: "processing-status",
        data: event.data.data,
      })
      .catch(() => {});
    return;
  }

  if (status === "result") {
    console.log("[Offscreen] Transcription result:", text);
    chrome.runtime
      .sendMessage({
        type: "transcription-update",
        data: text,
        processingTime: event.data.processingTime,
        realTimeRatio: event.data.realTimeRatio,
      })
      .catch(() => {});
  } else if (
    status === "initiate" ||
    status === "download" ||
    status === "progress" ||
    status === "done"
  ) {
    console.log("[Offscreen] Model progress:", {
      file,
      progress,
      loaded,
      total,
      status,
    });

    chrome.runtime
      .sendMessage({
        type: "model-progress",
        data: { file, progress, loaded, total, status },
      })
      .catch(() => {});

    chrome.runtime
      .sendMessage({
        type: "model-status-update",
        status: message || "Loading...",
      })
      .catch(() => {});

    try {
      if (chrome && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ modelStatus: message || "Loading..." });
      }
    } catch (e) {
      console.log("[Offscreen] Could not save to storage:", e);
    }
  } else if (status === "ready") {
    console.log("[Offscreen] Model ready!");

    chrome.runtime
      .sendMessage({
        type: "model-status-update",
        status: "Ready",
      })
      .catch(() => {});

    chrome.runtime
      .sendMessage({
        type: "model-progress",
        data: { status: "ready" },
      })
      .catch(() => {});

    try {
      if (chrome && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ modelStatus: "Ready" });
      }
    } catch (e) {
      console.log("[Offscreen] Could not save to storage:", e);
    }
  } else if (status === "error") {
    console.error("[Offscreen] Model error:", error);

    chrome.runtime
      .sendMessage({
        type: "model-status-update",
        status: `Error: ${error}`,
      })
      .catch(() => {});

    try {
      if (chrome && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ modelStatus: `Error: ${error}` });
      }
    } catch (e) {
      console.log("[Offscreen] Could not save to storage:", e);
    }
  } else if (status === "processing") {
    console.log("[Offscreen] Processing audio...");
  } else if (status === "complete") {
    console.log("[Offscreen] Transcription complete");
  }
};

transcriptionWorker.onerror = (error) => {
  console.error("[Offscreen] Worker error event:", error);
  console.error("[Offscreen] Error message:", error.message);
  console.error("[Offscreen] Error filename:", error.filename);
  console.error("[Offscreen] Error lineno:", error.lineno);
  console.error("[Offscreen] Error colno:", error.colno);
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // console.log("[Offscreen] Chrome message received:", message);

  if (message.target && message.target !== "offscreen") {
    return false;
  }
  if (message.type === "init-model") {
    console.log("[Offscreen] Received init-model message:", message.model);

    if (!workerInitialized) {
      transcriptionWorker.postMessage({
        type: "init",
        model: message.model || "Xenova/whisper-tiny.en",
      });

      workerInitialized = true;
    }

    sendResponse({ success: true });
    return true;
  } else if (message.type === "start-capture") {
    console.log("[Offscreen] Handling start-capture message");
    console.log("[Offscreen] Transcription mode:", message.data.mode);

    currentTranscriptionMode = message.data.mode || "batch";

    // Make sure worker is initialized before starting capture
    if (!workerInitialized) {
      console.log("[Offscreen] Worker not initialized, waiting...");
      setTimeout(() => {
        startCapture(message.data.streamId, currentTranscriptionMode);
      }, 1000);
    } else {
      startCapture(message.data.streamId, currentTranscriptionMode);
    }

    sendResponse({ success: true });
    return true;
  } else if (message.type === "stop-capture") {
    console.log("[Offscreen] Handling stop-capture message");

    stopCapture();

    sendResponse({ success: true });
    return true;
  } else if (message.type === "reload-model") {
    console.log(
      "[Offscreen] Handling reload-model message for model:",
      message.model
    );

    transcriptionWorker.postMessage({
      type: "reload-model",
      model: message.model,
    });

    console.log("[Offscreen] Reload message sent to worker");

    sendResponse({ success: true });
    return true;
  }

  return false;
});

async function startCapture(streamId, mode) {
  try {
    console.log(
      "[Offscreen] Starting capture with streamId:",
      streamId,
      "mode:",
      mode
    );

    // Get media stream
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: streamId,
        },
      },
    });
    console.log("[Offscreen] Got media stream:", mediaStream);

    // Create audio context to keep tab audio playing
    audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(mediaStream);
    source.connect(audioContext.destination); // Avoid muting the main tab

    console.log("[Offscreen] Audio context created");

    // Initialize buffers
    recordedChunks = [];
    // Send mode to worker
    transcriptionWorker.postMessage({
      type: "set-mode",
      mode: mode,
    });

    if (mode === "streaming") {
      // Streaming mode: Stop and restart recorder every 30 seconds
      startStreamingRecorder(mediaStream);
    } else {
      // Batch mode: Record everything continuously
      startBatchRecorder(mediaStream);
    }

    chrome.runtime
      .sendMessage({
        type: "capture-started",
      })
      .catch(() => {});
  } catch (error) {
    console.error("[Offscreen] Error capturing audio:", error);

    chrome.runtime
      .sendMessage({
        type: "capture-error",
        error: error.message,
      })
      .catch(() => {});

    throw error;
  }
}

function startStreamingRecorder(stream) {
  console.log("[Offscreen] Starting streaming recorder");

  const TIMESLICE_MS = 30000; // 30 s slices
  const CHUNK_SEC = TIMESLICE_MS / 1000;

  let allChunks = []; // accumulate every chunk
  let lastDecodedSec = 0; // seconds already decoded

  mediaRecorder = new MediaRecorder(stream);

  mediaRecorder.ondataavailable = async (event) => {
    if (!event.data || event.data.size === 0) {
      console.warn("[Offscreen] Empty chunk");
      return;
    }

    console.log("[Offscreen] Chunk received:", event.data.size, "bytes");
    allChunks.push(event.data);

    // Whenever we have another slice, decode the full container blob
    // then skip the already-decoded portion
    const blob = new Blob(allChunks, { type: mediaRecorder.mimeType });
    try {
      await decodeAndTranscribe(blob, "streaming", lastDecodedSec);
      lastDecodedSec += CHUNK_SEC;
    } catch (e) {
      console.error("[Offscreen] Decode/transcribe error:", e);
    }
  };

  mediaRecorder.onstop = () => {
    console.log("[Offscreen] Recorder stopped");
    allChunks = [];
    lastDecodedSec = 0;
  };

  mediaRecorder.onerror = (err) => {
    console.error("[Offscreen] Recorder error:", err);
  };

  mediaRecorder.start(TIMESLICE_MS);
  console.log("[Offscreen] Recording every 30 s");
}

async function decodeAndTranscribe(audioBlob, mode, skipSeconds = 0) {
  let tempAudioContext = null;

  try {
    console.log("[Offscreen] Decoding audio blob:", audioBlob.size, "bytes");
    console.log(
      "[Offscreen] Skip first",
      skipSeconds,
      "seconds (already transcribed)"
    );

    if (audioBlob.size < 1000) {
      throw new Error("Audio blob too small");
    }

    const arrayBuffer = await audioBlob.arrayBuffer();

    tempAudioContext = new AudioContext();
    console.log(
      "[Offscreen] AudioContext created, sample rate:",
      tempAudioContext.sampleRate
    );

    const audioBuffer = await tempAudioContext.decodeAudioData(arrayBuffer);

    console.log("[Offscreen] Audio decoded successfully");
    console.log("[Offscreen] - Duration:", audioBuffer.duration, "seconds");
    console.log("[Offscreen] - Sample rate:", audioBuffer.sampleRate);

    if (audioBuffer.duration === 0) {
      throw new Error("Audio has zero duration");
    }

    // Extract audio data
    let audioData = audioBuffer.getChannelData(0);

    // Skip the part we already transcribed
    if (skipSeconds > 0) {
      const skipSamples = Math.floor(skipSeconds * audioBuffer.sampleRate);
      console.log("[Offscreen] Skipping", skipSamples, "samples");

      if (skipSamples < audioData.length) {
        audioData = audioData.slice(skipSamples);
        console.log(
          "[Offscreen] Remaining audio:",
          audioData.length,
          "samples"
        );
      } else {
        console.log("[Offscreen] No new audio to transcribe");
        await tempAudioContext.close();
        return;
      }
    }

    // Resample to 16kHz if needed
    if (audioBuffer.sampleRate !== 16000) {
      console.log(
        "[Offscreen] Resampling from",
        audioBuffer.sampleRate,
        "to 16000 Hz"
      );
      audioData = resampleAudio(audioData, audioBuffer.sampleRate, 16000);
    }

    const durationSeconds = audioData.length / 16000;
    console.log(
      "[Offscreen] Sending to worker:",
      durationSeconds.toFixed(1),
      "seconds"
    );

    await tempAudioContext.close();

    // Send to worker
    transcriptionWorker.postMessage({
      type: "process-decoded-audio",
      audioData: audioData,
      mode: mode,
      durationSeconds: durationSeconds,
    });
  } catch (error) {
    console.error("[Offscreen] Error in decodeAndTranscribe:", error);

    if (tempAudioContext && tempAudioContext.state !== "closed") {
      try {
        await tempAudioContext.close();
      } catch (e) {}
    }

    transcriptionWorker.postMessage({
      type: "audio-decode-error",
      error: error.message,
    });
  }
}

function resampleAudio(audioData, sourceRate, targetRate) {
  if (sourceRate === targetRate) {
    return audioData;
  }

  const ratio = sourceRate / targetRate;
  const newLength = Math.round(audioData.length / ratio);
  const result = new Float32Array(newLength);

  for (let i = 0; i < newLength; i++) {
    const sourceIndex = i * ratio;
    const index = Math.floor(sourceIndex);
    const fraction = sourceIndex - index;

    if (index + 1 < audioData.length) {
      result[i] =
        audioData[index] * (1 - fraction) + audioData[index + 1] * fraction;
    } else {
      result[i] = audioData[index];
    }
  }

  return result;
}

function startBatchRecorder(stream) {
  console.log("[Offscreen] Starting batch recorder");

  // Reset recorded chunks
  recordedChunks = [];

  // Create MediaRecorder with defaults
  mediaRecorder = new MediaRecorder(stream);

  console.log("[Offscreen] MediaRecorder created with defaults");
  console.log("[Offscreen] - Actual MIME type:", mediaRecorder.mimeType);
  console.log(
    "[Offscreen] - Audio bits per second:",
    mediaRecorder.audioBitsPerSecond || "default"
  );

  mediaRecorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      console.log("[Offscreen] Batch chunk:", event.data.size, "bytes");
      recordedChunks.push(event.data);
    }
  };

  mediaRecorder.onstop = () => {
    console.log(
      "[Offscreen] Batch recording complete, chunks:",
      recordedChunks.length
    );

    if (recordedChunks.length > 0) {
      const audioBlob = new Blob(recordedChunks, {
        type: mediaRecorder.mimeType,
      });

      console.log(
        "[Offscreen] Sending batch to transcribe:",
        audioBlob.size,
        "bytes"
      );

      // Batch mode: transcribe entire recording from start
      decodeAndTranscribe(audioBlob, "batch", 0);
    }

    // Clear chunks for next recording
    recordedChunks = [];
  };

  mediaRecorder.onerror = (error) => {
    console.error("[Offscreen] MediaRecorder error:", error);
  };

  // Start recording without a timeslice to capture full audio
  mediaRecorder.start();
  console.log("[Offscreen] Batch recording started");
}

function stopCapture() {
  console.log("[Offscreen] Stopping capture");

  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
    console.log("[Offscreen] MediaRecorder stopped");
  }

  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    console.log("[Offscreen] Media stream tracks stopped");
  }

  if (audioContext) {
    audioContext.close();
    console.log("[Offscreen] Audio context closed");
  }

  chrome.runtime
    .sendMessage({
      type: "capture-stopped",
    })
    .catch(() => {});
}

console.log("[Offscreen] Script initialization complete");

// Fallback initialization if no message received within 2 seconds
setTimeout(() => {
  if (!workerInitialized) {
    console.log("[Offscreen] No init message received, using default model");
    transcriptionWorker.postMessage({
      type: "init",
      model: "Xenova/whisper-tiny.en",
    });
    workerInitialized = true;
  }
}, 2000);
