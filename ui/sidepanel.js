console.log("[Sidepanel] Script loaded");

const startBtn = document.getElementById("start-btn");
const stopBtn = document.getElementById("stop-btn");
const statusText = document.getElementById("status-text");
const statusDot = document.getElementById("status-dot");
const modelStatus = document.getElementById("model-status");
const gpuStatus = document.getElementById("gpu-status");
const modelLoading = document.getElementById("model-loading");
const progressItems = document.getElementById("progress-items");
const transcriptText = document.getElementById("transcript-text");
const copyBtn = document.getElementById("copy-btn");
const downloadBtn = document.getElementById("download-btn");
const clearBtn = document.getElementById("clear-btn");
const modelSelect = document.getElementById("model-select");
const reloadModelBtn = document.getElementById("reload-model-btn");
const recordingTimer = document.getElementById("recording-timer");
const processingSection = document.getElementById("processing-section");
const bufferSize = document.getElementById("buffer-size");
const processingStatus = document.getElementById("processing-status");
// const processingSpeed = document.getElementById("processing-speed");
// const chunksProcessed = document.getElementById("chunks-processed");
const processingDetail = document.getElementById("processing-detail");
const transcriptionMode = document.getElementById("transcription-mode");
const batchWarning = document.getElementById("batch-warning");
// const bufferLabel = document.getElementById("buffer-label");
// const chunksLabel = document.getElementById("chunks-label");
const typingIndicator = document.getElementById("typing-indicator");
const modelToggle = document.getElementById("model-toggle");
const modelContent = document.getElementById("model-content");
// const toggleIcon = document.getElementById("model-toggle-icon");
const toggleLabel = document.getElementById("model-toggle-label");
const toggleSummary = document.getElementById("model-toggle-summary");
const modelStatusSpan = document.getElementById("model-status");
const gpuStatusSpan = document.getElementById("gpu-status");

let currentMode = "batch"; // Default to batch mode
let totalChunksProcessed = 0;
let fullTranscript = "";
let isRecording = false;
let recordingStartTime = null;
let timerInterval = null;
const fileProgress = new Map();
let currentGpuStatus = "unknown";

let animationQueue = [];
let isAnimating = false;
let skipAnimation = false;

// Initialize - Load saved settings
chrome.storage.local.get(
  [
    "transcript",
    "modelStatus",
    "selectedModel",
    "gpuStatus",
    "transcriptionMode",
    "modelSectionCollapsed",
  ],
  (result) => {
    console.log("[Sidepanel] Loaded from storage:", result);

    if (result.transcript) {
      fullTranscript = result.transcript;
      transcriptText.textContent = fullTranscript;
    }

    if (result.modelStatus) {
      console.log(
        "[Sidepanel] Setting initial model status:",
        result.modelStatus
      );
      updateModelStatus(result.modelStatus);
    }

    if (result.gpuStatus) {
      updateGpuStatus(result.gpuStatus);
    }

    if (result.transcriptionMode) {
      currentMode = result.transcriptionMode;
      transcriptionMode.value = currentMode;
      console.log("[Sidepanel] Loaded transcription mode:", currentMode);

      // Show warning if batch mode
      if (currentMode === "batch") {
        batchWarning.classList.remove("hidden");
      }
    }

    if (result.selectedModel) {
      modelSelect.value = result.selectedModel;
      console.log("[Sidepanel] Loaded selected model:", result.selectedModel);
    }

    if (result.modelSectionCollapsed) {
      modelContent.classList.remove("visible");
      modelToggle.classList.add("collapsed");
    } else {
      modelContent.classList.add("visible");
      modelToggle.classList.add("expanded");
    }
  }
);

function updateToggleSummary() {
  const modelMap = {
    "Xenova/whisper-tiny.en": "W-T",
    "Xenova/whisper-base.en": "W-B",
    "Xenova/whisper-small.en": "W-S",
  };
  
  const modelValue = modelSelect.value;
  const modelEmoji = `🤖 ${modelMap[modelValue] || '❓'}`;
  const gpuEmoji = gpuStatusSpan.textContent === "WebGPU" ? "⚡" : "🧊";
  toggleSummary.textContent = `${modelEmoji}${gpuEmoji}`;
}

// Initialize summary
updateToggleSummary();

modelToggle.addEventListener("click", () => {
  const isCollapsed = modelContent.classList.toggle("visible") === false;
  modelToggle.classList.toggle("expanded", !isCollapsed);
  modelToggle.classList.toggle("collapsed", isCollapsed);
  // toggleIcon.textContent = isCollapsed ? "▶" : "▼";
  // toggleLabel.textContent = isCollapsed ? "Model S" : "Model Settings";
  // Always show summary
  toggleSummary.style.display = isCollapsed ? "inline" : "none";
  chrome.storage.local.set({ modelSectionCollapsed: isCollapsed });
});

// Transcription mode selection
transcriptionMode.addEventListener("change", () => {
  currentMode = transcriptionMode.value;
  console.log("[Sidepanel] Transcription mode changed to:", currentMode);
  chrome.storage.local.set({ transcriptionMode: currentMode });

  // Show/hide warning
  if (currentMode === "batch") {
    batchWarning.classList.remove("hidden");
    showNotification("Batch mode: Transcription happens when you click Stop");
  } else {
    batchWarning.classList.add("hidden");
    showNotification("Streaming mode: Transcription every 30 seconds");
  }
});

// Model selection change
modelSelect.addEventListener("change", () => {
  const selectedModel = modelSelect.value;
  console.log("[Sidepanel] Model changed to:", selectedModel);
  chrome.storage.local.set({ selectedModel: selectedModel });

  // Show notification with model info
  const modelInfo = {
    "Xenova/whisper-tiny.en": "Fastest, 39MB",
    "Xenova/whisper-base.en": "Balanced, 142MB",
    "Xenova/whisper-small.en": "Best quality, 244MB",
  };

  showNotification(
    `Selected: ${selectedModel.split("/")[1]} (${modelInfo[selectedModel]})`
  );
  updateToggleSummary()
});

// Reload model button
reloadModelBtn.addEventListener("click", async () => {
  console.log("[Sidepanel] Reload model clicked");
  const selectedModel = modelSelect.value;

  reloadModelBtn.disabled = true;
  reloadModelBtn.textContent = "Reloading...";

  try {
    await chrome.runtime.sendMessage({
      type: "reload-model",
      model: selectedModel,
    });

    showNotification("Model reload initiated");
  } catch (error) {
    console.error("[Sidepanel] Error reloading model:", error);
    showNotification("Failed to reload model");
  } finally {
    setTimeout(() => {
      reloadModelBtn.disabled = false;
      reloadModelBtn.textContent = "Reload Model";
    }, 2000);
  }
});

// Timer functions
function startTimer() {
  recordingStartTime = Date.now();
  timerInterval = setInterval(updateTimer, 1000);
  updateTimer();
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function updateTimer() {
  if (!recordingStartTime) return;

  const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;

  recordingTimer.textContent = `${String(minutes).padStart(2, "0")}:${String(
    seconds
  ).padStart(2, "0")}`;
}

function resetTimer() {
  recordingTimer.textContent = "00:00";
  recordingStartTime = null;
}

// Start Recording Button
startBtn.addEventListener("click", async () => {
  console.log("[Sidepanel] Start button clicked");

  startBtn.disabled = true;
  statusText.textContent = "Starting...";

  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    console.log("[Sidepanel] Active tab:", tab.id);

    const selectedModel = modelSelect.value;
    console.log(
      "[Sidepanel] Sending start-recording message with model:",
      selectedModel
    );
    console.log("[Sidepanel] Transcription mode:", currentMode);

    const response = await chrome.runtime.sendMessage({
      type: "start-recording",
      tabId: tab.id,
      model: selectedModel,
      mode: currentMode, // Send the mode
    });

    console.log("[Sidepanel] Got response:", response);

    if (response && response.success) {
      console.log("[Sidepanel] Recording started successfully");
      updateRecordingState(true);
      startTimer();
    } else {
      console.error("[Sidepanel] Recording failed:", response);
      statusText.textContent =
        "Failed to start: " + (response?.error || "Unknown error");
      startBtn.disabled = false;
    }
  } catch (error) {
    console.error("[Sidepanel] Error starting recording:", error);
    statusText.textContent = "Error: " + error.message;
    startBtn.disabled = false;
  }
});

// Stop Recording Button
stopBtn.addEventListener("click", async () => {
  console.log("[Sidepanel] Stop button clicked");

  stopBtn.disabled = true;
  statusText.textContent = "Stopping...";

  try {
    console.log("[Sidepanel] Sending stop-recording message...");
    const response = await chrome.runtime.sendMessage({
      type: "stop-recording",
    });

    console.log("[Sidepanel] Got response:", response);

    if (response && response.success) {
      console.log("[Sidepanel] Recording stopped successfully");
      updateRecordingState(false);
      stopTimer();
    } else {
      console.error("[Sidepanel] Stop failed:", response);
      statusText.textContent =
        "Failed to stop: " + (response?.error || "Unknown error");
      stopBtn.disabled = false;
    }
  } catch (error) {
    console.error("[Sidepanel] Error stopping recording:", error);
    statusText.textContent = "Error: " + error.message;
    stopBtn.disabled = false;
  }
});

// Copy Button
copyBtn.addEventListener("click", () => {
  console.log("[Sidepanel] Copy button clicked");
  navigator.clipboard.writeText(fullTranscript);
  showNotification("Copied to clipboard!");
});

// Download Button
downloadBtn.addEventListener("click", () => {
  console.log("[Sidepanel] Download button clicked");
  downloadTranscript(fullTranscript);
});

// Clear Button
// Clear Button
clearBtn.addEventListener("click", () => {
  console.log("[Sidepanel] Clear button clicked");
  if (confirm("Clear all transcript text?")) {
    fullTranscript = "";
    transcriptText.textContent = "";
    animationQueue = [];
    isAnimating = false;
    skipAnimation = false;
    chrome.storage.local.remove("transcript");
    showNotification("Transcript cleared");
  }
});

// Listen for messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("[Sidepanel] Message received:", message.type, message);

  if (message.type === "display-transcription") {
    // Hide typing indicator when text arrives
    typingIndicator.classList.add("hidden");

    appendTranscription(message.data);

    if (message.processingTime && message.realTimeRatio) {
      console.log(
        `[Sidepanel] Performance: ${message.processingTime}s (${message.realTimeRatio}x realtime)`
      );

      //   processingSpeed.textContent = `${message.realTimeRatio}x RT`;
      //   processingSpeed.className =
      //     "stat-value " +
      //     (parseFloat(message.realTimeRatio) >= 1 ? "stat-good" : "stat-slow");

      totalChunksProcessed++;
      //   chunksProcessed.textContent = totalChunksProcessed;
    }
  } else if (message.type === "processing-status") {
    updateProcessingStatus(message.data);

    // Show typing indicator when processing
    if (message.data.isProcessing) {
      typingIndicator.classList.remove("hidden");
    } else {
      typingIndicator.classList.add("hidden");
    }
  } else if (message.type === "model-status-update") {
    console.log("[Sidepanel] Model status update:", message.status);
    updateModelStatus(message.status);
  } else if (message.type === "gpu-status-update") {
    console.log("[Sidepanel] GPU status update:", message.status);
    updateGpuStatus(message.status);
  } else if (message.type === "model-progress") {
    console.log("[Sidepanel] Model progress:", message.data);
    updateFileProgress(message.data);
  } else if (message.type === "recording-state-changed") {
    updateRecordingState(message.isRecording);
  }

  return true;
});

console.log("[Sidepanel] Message listener registered");

// function updateProcessingStatus(data) {
//   const { bufferSeconds, isProcessing, detail } = data;

//   // Update buffer display
//   bufferSize.textContent = `Buffer: ${bufferSeconds.toFixed(1)}s`;

//   // Update status display
//   processingStatus.textContent = isProcessing ? 'Processing…' : 'Idle';

//   // Update detail message
//   if (detail) processingDetail.textContent = detail;
// }

function updateProcessingStatus(data) {
  const { bufferSeconds, isProcessing, processingSeconds, detail } = data;

  console.log("[Sidepanel] Processing status update:", data);

  // Update buffer size
  if (bufferSeconds !== undefined) {
    const minutes = Math.floor(bufferSeconds / 60);
    const seconds = Math.floor(bufferSeconds % 60);

    // Show as MM:SS for better readability
    if (currentMode === "batch") {
      bufferSize.textContent = `${minutes}:${String(seconds).padStart(2, "0")}`;
    } else {
      bufferSize.textContent = `${bufferSeconds.toFixed(1)}s`;
    }

    // Warning colors based on buffer size
    if (currentMode === "batch") {
      if (bufferSeconds >= 900) {
        // 15 minutes
        bufferSize.className = "stat-value stat-critical";
      } else if (bufferSeconds >= 600) {
        // 10 minutes
        bufferSize.className = "stat-value stat-warning";
      } else if (bufferSeconds >= 300) {
        // 5 minutes
        bufferSize.className = "stat-value stat-caution";
      } else {
        bufferSize.className = "stat-value";
      }
    } else {
      bufferSize.className =
        "stat-value " + (bufferSeconds >= 25 ? "stat-warning" : "");
    }
  }

  // Update processing status
  if (isProcessing !== undefined) {
    processingStatus.textContent = isProcessing ? "Active" : "Idle";
    processingStatus.className =
      "stat-value " + (isProcessing ? "stat-active" : "");

    if (isProcessing && processingSeconds !== undefined) {
      const minutes = Math.floor(processingSeconds / 60);
      const seconds = Math.floor(processingSeconds % 60);
      const estimatedTime = processingSeconds / 2; // Rough estimate: 2x realtime
      processingDetail.textContent = `Transcribing ${minutes}:${String(
        seconds
      ).padStart(2, "0")}... (est. ${estimatedTime.toFixed(0)}s)`;
    }
  }

  // Update detail message
  if (detail) {
    console.log("[Sidepanel] Setting detail message:", detail);
    processingDetail.textContent = detail;
  }
}

function updateRecordingState(recording) {
  console.log("[Sidepanel] Updating recording state:", recording);
  isRecording = recording;

  if (recording) {
    startBtn.disabled = true;
    stopBtn.disabled = false;
    statusText.textContent =
      currentMode === "batch"
        ? "Recording... (will transcribe on stop)"
        : "Recording... (streaming)";
    statusDot.classList.add("recording");
    modelSelect.disabled = true;
    reloadModelBtn.disabled = true;
    transcriptionMode.disabled = true;

    // Update labels based on mode
    // if (currentMode === "batch") {
    //   bufferLabel.textContent = "Total Recorded:";
    //   chunksLabel.textContent = "Final Chunk:";
    // } else {
    //   bufferLabel.textContent = "Audio Buffer:";
    //   chunksLabel.textContent = "Chunks Done:";
    // }

    // Show processing section in BOTH modes
    processingSection.classList.remove("hidden");

    totalChunksProcessed = 0;
    // chunksProcessed.textContent = "0";
    // processingSpeed.textContent = "-";
    processingDetail.textContent =
      currentMode === "batch"
        ? "Batch mode: Recording audio..."
        : "Streaming mode: Waiting for audio...";
  } else {
    startBtn.disabled = false;
    stopBtn.disabled = true;
    statusText.textContent = "Ready to record";
    statusDot.classList.remove("recording");
    modelSelect.disabled = false;
    reloadModelBtn.disabled = false;
    transcriptionMode.disabled = false;
    resetTimer();

    // Keep processing section visible for a bit longer to show final transcription status
    setTimeout(() => {
      processingSection.classList.add("hidden");
    }, 5000);
  }
}

function updateModelStatus(status) {
  console.log("[Sidepanel] updateModelStatus called with:", status);
  modelStatus.textContent = status;

  if (
    status === "Ready" ||
    status.includes("ready") ||
    status.includes("Completed")
  ) {
    modelStatus.className = "model-status status-ready";
    modelLoading.classList.add("hidden");
    startBtn.disabled = false;
    modelStatus.textContent = "Ready";
    console.log("[Sidepanel] Model is ready, start button enabled");
  } else if (status.includes("Error")) {
    modelStatus.className = "model-status status-error";
    modelLoading.classList.add("hidden");
  } else if (
    status.includes("Loading") ||
    status.includes("Initializing") ||
    status.includes("Downloading")
  ) {
    modelStatus.className = "model-status status-loading";
    modelLoading.classList.remove("hidden");
    startBtn.disabled = true;
    console.log("[Sidepanel] Model is loading...");
  }
}

function updateGpuStatus(status) {
  currentGpuStatus = status;
  chrome.storage.local.set({ gpuStatus: status });

  if (status === "webgpu") {
    gpuStatus.textContent = "WebGPU";
    gpuStatus.className = "gpu-status gpu-enabled";
  } else if (status === "wasm") {
    gpuStatus.textContent = "WASM (CPU)";
    gpuStatus.className = "gpu-status gpu-disabled";
  } else {
    gpuStatus.textContent = "Unknown";
    gpuStatus.className = "gpu-status";
  }
  updateToggleSummary()
}

function updateFileProgress(data) {
  console.log("[Sidepanel] updateFileProgress called with:", data);
  const { file, progress, loaded, total, status } = data;

  if (status === "initiate") {
    modelLoading.classList.remove("hidden");
    return;
  }

  if (status === "progress" || status === "download") {
    if (!fileProgress.has(file)) {
      createProgressBar(file);
      fileProgress.set(file, { progress: 0, loaded: 0, total: 0 });
    }

    const progressPercent =
      progress || (loaded && total ? (loaded / total) * 100 : 0);
    fileProgress.set(file, { progress: progressPercent, loaded, total });

    updateProgressBar(file, progressPercent, loaded, total);
  } else if (status === "done") {
    updateProgressBar(file, 100, total, total);
  } else if (status === "ready") {
    modelLoading.classList.add("hidden");
    fileProgress.clear();
    progressItems.innerHTML = "";
  }
}

function createProgressBar(fileName) {
  const progressItem = document.createElement("div");
  progressItem.className = "progress-item";
  progressItem.id = `progress-${sanitizeId(fileName)}`;

  progressItem.innerHTML = `
    <div class="progress-header">
      <span class="file-name">${truncateFileName(fileName)}</span>
      <span class="progress-percent">0%</span>
    </div>
    <div class="progress-bar-container">
      <div class="progress-bar" style="width: 0%"></div>
    </div>
    <div class="progress-details">
      <span class="file-size">0 MB / 0 MB</span>
    </div>
  `;

  progressItems.appendChild(progressItem);
}

function updateProgressBar(fileName, progress, loaded, total) {
  const progressItem = document.getElementById(
    `progress-${sanitizeId(fileName)}`
  );
  if (!progressItem) return;

  const progressBar = progressItem.querySelector(".progress-bar");
  const progressPercent = progressItem.querySelector(".progress-percent");
  const fileSize = progressItem.querySelector(".file-size");

  progressBar.style.width = `${progress}%`;
  progressPercent.textContent = `${Math.round(progress)}%`;

  if (loaded && total) {
    fileSize.textContent = `${formatBytes(loaded)} / ${formatBytes(total)}`;
  }

  if (progress >= 100) {
    progressBar.classList.add("complete");
  }
}

function downloadTranscript(text) {
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);

  const downloadLink = document.createElement("a");
  downloadLink.href = url;

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  downloadLink.download = `transcript-${timestamp}.txt`;

  document.body.appendChild(downloadLink);
  downloadLink.click();
  document.body.removeChild(downloadLink);
  URL.revokeObjectURL(url);

  showNotification("Transcript downloaded!");
}

function showNotification(message) {
  const notification = document.createElement("div");
  notification.className = "notification";
  notification.textContent = message;
  document.body.appendChild(notification);

  setTimeout(() => {
    notification.remove();
  }, 2000);
}

function showBriefNotification(message) {
  statusText.textContent = message;
  setTimeout(() => {
    if (isRecording) {
      statusText.textContent = "Recording...";
    } else {
      statusText.textContent = "Ready to Record...";
    }
  }, 2000);
}

function sanitizeId(fileName) {
  return fileName.replace(/[^a-zA-Z0-9]/g, "_");
}

function truncateFileName(fileName) {
  const maxLength = 40;
  if (fileName.length <= maxLength) return fileName;
  return fileName.substring(0, maxLength - 3) + "...";
}

function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function appendTranscription(text) {
  console.log("[Sidepanel] Appending transcription:", text);

  if (!text || text.trim().length === 0 || text === "[...]") {
    console.log("[Sidepanel] Skipping empty transcription");
    return;
  }

  // Add to animation queue
  animationQueue.push(text);

  // Start animation if not already running
  if (!isAnimating) {
    animateNextInQueue();
  }

  // Update full transcript (saved, not displayed yet)
  if (fullTranscript.length > 0) {
    fullTranscript += " ";
  }
  fullTranscript += text;
  chrome.storage.local.set({ transcript: fullTranscript });

  showBriefNotification(`✓ ${text.substring(0, 30)}...`);
}

async function animateNextInQueue() {
  if (animationQueue.length === 0) {
    isAnimating = false;
    skipAnimation = false;
    return;
  }

  isAnimating = true;
  const text = animationQueue.shift();

  // Skip animation if requested
  if (skipAnimation) {
    if (transcriptText.textContent.length > 0) {
      transcriptText.textContent += " ";
    }
    transcriptText.textContent += text;
    transcriptText.scrollTop = transcriptText.scrollHeight;
    animateNextInQueue();
    return;
  }

  // Add space before new text if transcript already has content
  if (transcriptText.textContent.length > 0) {
    transcriptText.textContent += " ";
  }

  // Animate word by word
  const words = text.split(" ");

  for (let i = 0; i < words.length; i++) {
    if (skipAnimation) {
      // If user clicked to skip, dump remaining text
      transcriptText.textContent += words.slice(i).join(" ");
      break;
    }

    const word = words[i];

    // Add the word with a trailing space (except last word)
    const textToAdd = i < words.length - 1 ? word + " " : word;

    // Append to display
    transcriptText.textContent += textToAdd;

    // Scroll to bottom
    transcriptText.scrollTop = transcriptText.scrollHeight;

    // Wait 100ms before next word
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  // Continue with next item in queue
  animateNextInQueue();
}

// Click transcript to skip animation
transcriptText.addEventListener("click", () => {
  if (isAnimating) {
    console.log("[Sidepanel] Skipping animation");
    skipAnimation = true;
  }
});

console.log("[Sidepanel] All event listeners registered");

// Request current status on load
setTimeout(() => {
  console.log("[Sidepanel] Requesting current model status from background");
  chrome.runtime
    .sendMessage({ type: "get-model-status" })
    .then((response) => {
      if (response && response.status) {
        console.log("[Sidepanel] Got model status:", response.status);
        updateModelStatus(response.status);
      }
      if (response && response.gpuStatus) {
        console.log("[Sidepanel] Got GPU status:", response.gpuStatus);
        updateGpuStatus(response.gpuStatus);
      }
    })
    .catch((err) =>
      console.log("[Sidepanel] Could not get model status:", err)
    );
}, 500);
