// workers/transcription-worker.js

console.log("[Worker] Script starting...");

import { pipeline, env } from "../libs/transformers.min.js";

console.log("[Worker] Transformers.js imported");

class PipelineFactory {
  static task = "automatic-speech-recognition";
  static model = null;
  static instance = null;
  static device = null;

  static async getInstance(modelName, progress_callback = null) {
    // Create once
    if (this.instance === null) {
      // Device detection: webgpu if available, else wasm
      let device = "wasm";
      if (typeof navigator !== "undefined" && "gpu" in navigator) {
        try {
          const adapter = await navigator.gpu.requestAdapter();
          if (adapter) device = "webgpu";
        } catch (e) {
          device = "wasm";
        }
      }
      this.device = device;

      // If model changes/disposed, clean up old
      if (this.model !== modelName && this.instance !== null) {
        try {
          const old = await this.instance;
          if (old && typeof old.dispose === "function") old.dispose();
        } catch (e) {}
        this.instance = null;
      }
      this.model = modelName;

      this.instance = pipeline(this.task, modelName, {
        device: device,
        dtype: "fp32",
        progress_callback,
        revision: modelName.includes("/whisper-medium")
          ? "no_attentions"
          : "main",
      });
    }
    return this.instance;
  }

  static async dispose() {
    if (this.instance !== null) {
      try {
        const instance = await this.instance;
        if (instance && typeof instance.dispose === "function")
          instance.dispose();
      } catch (e) {}
      this.instance = null;
      this.model = null;
      this.device = null;
    }
  }
}

// env.allowLocalModels = false;
// env.allowRemoteModels = true;
// env.useBrowserCache = true;
// env.backends.onnx.wasm.numThreads = 1;
// env.backends.onnx.wasm.proxy = false;

console.log("[Worker] Environment configured");

// const hasWebGPU = typeof navigator !== "undefined" && "gpu" in navigator;

let transcriber;
let transcriptionMode = "batch";
let isProcessing = false;
let totalAudioDuration = 0;
let currentModelName = "Xenova/whisper-tiny.en";

function log(...args) {
  console.log("[Worker]", ...args);
  self.postMessage({
    type: "debug-log",
    message: args.join(" "),
  });
}

self.addEventListener("message", async (event) => {
  const { type } = event.data;

  if (type === "init") {
    log("Init message received");
    currentModelName = event.data.model || "Xenova/whisper-tiny.en";
    await initializeModel(currentModelName);
  } else if (type === "set-mode") {
    log("Setting transcription mode to:", event.data.mode);
    transcriptionMode = event.data.mode;

    self.postMessage({
      type: "processing-status",
      data: {
        detail: `Mode: ${
          transcriptionMode === "batch"
            ? "Batch (on stop)"
            : "Streaming (every 30s)"
        }`,
      },
    });
  } else if (type === "process-decoded-audio") {
    await processDecodedAudio(
      event.data.audioData,
      event.data.mode,
      event.data.durationSeconds,
      event.data.offset || 0
    );
  } else if (type === "audio-decode-error") {
    log("Audio decode error:", event.data.error);
    self.postMessage({
      status: "error",
      error: "Audio decode failed: " + event.data.error,
    });
  } else if (type === "reload-model") {
    log("Reload-model message received:", event.data.model);
    await reloadModel(event.data.model);
  } else {
    log("Unknown message type:", type);
  }
});

function progress_callback(progressData) {
  // log("Download progress:", JSON.stringify(progressData));

  self.postMessage({
    status: progressData.status,
    file: progressData.file || "model",
    progress: progressData.progress || 0,
    loaded: progressData.loaded || 0,
    total: progressData.total || 0,
    message: formatProgressMessage(progressData),
  });
}

async function initializeModel(modelName = "Xenova/whisper-tiny.en") {
  log("Initializing model:", modelName);

  self.postMessage({
    status: "initiate",
    message: `Initializing ${modelName}…`,
  });

  try {
    transcriber = await PipelineFactory.getInstance(
      modelName,
      progress_callback
    );

    const device = PipelineFactory.device || "wasm"; // Get the chosen backend
    log(`Model loaded: ${modelName} using ${device}`);

    self.postMessage({ type: "gpu-status", status: device });
    self.postMessage({
      status: "ready",
      message: `${modelName.split("/")[1]} ready (${device.toUpperCase()})`,
    });
  } catch (e) {
    log("Error loading model:", e);
    self.postMessage({ status: "error", error: e.message });
  }
}

async function reloadModel(modelName) {
  log("Reloading model:", modelName);
  currentModelName = modelName;

  self.postMessage({
    status: "initiate",
    message: `Loading ${modelName}...`,
  });

  try {
    // Dispose via factory
    await PipelineFactory.dispose();

    // Re-initialize
    await initializeModel(modelName);
  } catch (error) {
    log("Error reloading model:", error);
    self.postMessage({
      status: "error",
      error: error.message,
    });
  }
}
/*
async function processDecodedAudio(
  audioData,
  mode,
  durationSeconds,
  offset = 0
) {
  if (!transcriber) {
    log("Transcriber not ready");
    return;
  }

  if (isProcessing) {
    log("Already processing, skipping this chunk");
    return;
  }

  isProcessing = true;

  try {
    log(`Transcribing ${durationSeconds.toFixed(1)}s at offset ${offset}s`);

    const startTime = performance.now();
    totalAudioDuration += durationSeconds;

    // Send processing status (buffer = total for batch, current for streaming)
    self.postMessage({
      type: "processing-status",
      data: {
        bufferSeconds: mode === "batch" ? totalAudioDuration : durationSeconds,
        isProcessing: true,
        processingSeconds: durationSeconds,
        detail: `Transcribing ${durationSeconds.toFixed(1)}s of audio…`,
      },
    });

    self.postMessage({
      status: "processing",
      message: `Transcribing ${durationSeconds.toFixed(1)}s…`,
    });

    // Run transcription with offset
    const result = await transcriber(audioData, {
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: false,
      // language: "english",
      // task: "transcribe",
      return_language: false,
      // offset_seconds: offset,
    });

    const endTime = performance.now();
    const processingTime = ((endTime - startTime) / 1000).toFixed(2);
    const realTimeRatio = (durationSeconds / processingTime).toFixed(2);

    log(`Processing took ${processingTime}s (${realTimeRatio}x realtime)`);

    const transcribedText = result.text ? result.text.trim() : "";

    if (transcribedText.length > 0) {
      log("Transcription successful:", transcribedText);

      self.postMessage({
        status: "result",
        text: transcribedText,
        processingTime: processingTime,
        realTimeRatio: realTimeRatio,
      });
    } else {
      log("Empty transcription – may be silence");
    }

    // Send processing complete
    self.postMessage({
      type: "processing-status",
      data: {
        bufferSeconds: mode === "batch" ? totalAudioDuration : 0,
        isProcessing: false,
        detail: `Completed in ${processingTime}s (${realTimeRatio}x realtime)`,
      },
    });
  } catch (error) {
    log("Error processing decoded audio:", error);
    console.error("[Worker] Full error:", error);

    self.postMessage({ status: "error", error: error.message });

    self.postMessage({
      type: "processing-status",
      data: {
        bufferSeconds: 0,
        isProcessing: false,
        detail: `Error: ${error.message}`,
      },
    });
  } finally {
    isProcessing = false;
    if (mode === "batch") {
      totalAudioDuration = 0;
    }
  }
}
*/

async function processDecodedAudio(
  audioData,
  mode,
  durationSeconds,
  offset = 0
) {
  if (!transcriber) {
    log("Transcriber not ready");
    return;
  }
  if (isProcessing) {
    log("Already processing, skipping this chunk");
    return;
  }
  isProcessing = true;

  try {
    log(
      `Transcribing ${durationSeconds.toFixed(
        1
      )}s at offset ${offset}s, Mode: ${mode}, Model: ${currentModelName}`
    );

    const isEnglishOnly = currentModelName.endsWith(".en");
    const isDistilWhisper =
      currentModelName && currentModelName.startsWith("distil-whisper/");

    // Setup options
    const options = {
      chunk_length_s: isDistilWhisper ? 20 : 30,
      stride_length_s: isDistilWhisper ? 3 : 5,
      top_k: 0, // Greedy
      do_sample: false,
      force_full_sequences: false,
      return_timestamps: false,
      return_language: false,
      ...(offset ? { offset_seconds: offset } : {}),
      ...(!isEnglishOnly ? { language: "english", task: "transcribe" } : {}),
    };

    if (mode === "streaming") {
      options.callback_function = (beams) => {
        const partial = transcriber.tokenizer.decode(
          beams[0].output_token_ids,
          { skip_special_tokens: true }
        );
        self.postMessage({ status: "partial-result", text: partial.trim() });
      };
    }

    // Status update
    self.postMessage({
      type: "processing-status",
      data: {
        bufferSeconds:
          mode === "batch"
            ? totalAudioDuration + durationSeconds
            : durationSeconds,
        isProcessing: true,
        processingSeconds: durationSeconds,
        detail: `Transcribing ${durationSeconds.toFixed(1)}s of audio…`,
      },
    });

    self.postMessage({
      status: "processing",
      message: `Transcribing ${durationSeconds.toFixed(1)}s…`,
    });

    const startTime = performance.now();
    totalAudioDuration += durationSeconds;

    // Call the pipeline
    const result = await transcriber(audioData, options);

    const endTime = performance.now();
    const processingTime = ((endTime - startTime) / 1000).toFixed(2);
    const realTimeRatio = (durationSeconds / processingTime).toFixed(2);

    log(`Processing took ${processingTime}s (${realTimeRatio}x realtime)`);

    const transcribedText = result.text ? result.text.trim() : "";

    if (transcribedText.length > 0) {
      log("Transcription successful:", transcribedText);
      self.postMessage({
        status: "result",
        text: transcribedText,
        processingTime,
        realTimeRatio,
      });
    } else {
      log("Empty transcription – may be silence");
    }

    // Send processing complete
    self.postMessage({
      type: "processing-status",
      data: {
        bufferSeconds: mode === "batch" ? totalAudioDuration : 0,
        isProcessing: false,
        detail: `Completed in ${processingTime}s (${realTimeRatio}x realtime)`,
      },
    });
  } catch (error) {
    log("Error processing decoded audio:", error);
    console.error("[Worker] Full error:", error);

    self.postMessage({
      status: "error",
      error: error.message,
      stack: error.stack,
    });
    self.postMessage({
      type: "processing-status",
      data: {
        bufferSeconds: 0,
        isProcessing: false,
        detail: `Error: ${error.message}`,
      },
    });
  } finally {
    isProcessing = false;
    if (mode === "batch") totalAudioDuration = 0;
  }
}

function formatProgressMessage(data) {
  const { status, file, progress } = data;

  if (status === "initiate") {
    return "Starting model download...";
  } else if (status === "download" || status === "progress") {
    const fileName = file ? file.split("/").pop() : "file";
    const percent = progress ? Math.round(progress) : 0;
    return `Downloading ${fileName}: ${percent}%`;
  } else if (status === "done") {
    return `Completed: ${file}`;
  } else if (status === "ready") {
    return "Model ready!";
  }

  return "Loading...";
}

log("Worker loaded, waiting for init message with model name...");
// initializeModel();
