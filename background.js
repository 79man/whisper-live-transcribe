console.log("[Background] Service worker started");

let isRecording = false;
let currentModelStatus = "Initializing...";
let currentGpuStatus = "unknown";

let offscreenReady = false;
let offscreenInitializing = false;

chrome.action.onClicked.addListener(async (tab) => {
  console.log("[Background] Extension icon clicked");

  try {
    await chrome.sidePanel.open({ windowId: tab.windowId });
    console.log("[Background] Side panel opened");
    // Ensure offscreen is ready when sidepanel opens
    // Ensure offscreen is ready when sidepanel opens
    if (!offscreenReady && !offscreenInitializing) {
      console.log("[Background] Offscreen not ready, initializing...");
      await setupOffscreenDocument();
    }
  } catch (error) {
    console.error("[Background] Error opening side panel:", error);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("[Background] Message received:", message.type, message);

  // Messages that need responses
  if (message.type === "get-model-status") {
    console.log(
      "[Background] Responding with current model status:",
      currentModelStatus
    );
    sendResponse({
      status: currentModelStatus,
      gpuStatus: currentGpuStatus,
    });
    return false; // Synchronous response
  }

  if (message.type === "start-recording") {
    console.log(
      "[Background] Starting recording for tab:",
      message.tabId,
      "Transcription mode:",
      message.mode
    );

    (async () => {
      try {
        await startRecording(message.tabId, message.mode);
        console.log("[Background] Recording started, sending success response");
        sendResponse({ success: true });
      } catch (error) {
        console.error("[Background] Error starting recording:", error);
        sendResponse({ success: false, error: error.message });
      }
    })();

    return true;
  }

  if (message.type === "stop-recording") {
    console.log("[Background] Stopping recording");

    (async () => {
      try {
        await stopRecording();
        console.log("[Background] Recording stopped, sending success response");
        sendResponse({ success: true });
      } catch (error) {
        console.error("[Background] Error stopping recording:", error);
        sendResponse({ success: false, error: error.message });
      }
    })();

    return true; // Async response
  }

  if (message.type === "reload-model") {
    console.log("[Background] Reload model requested:", message.model);

    currentModelStatus = "Loading...";

    // Forward to sidepanel (fire and forget)
    setTimeout(() => {
      chrome.runtime
        .sendMessage({
          type: "model-status-update",
          status: "Loading new model...",
        })
        .catch(() => {});
    }, 0);

    // Forward to offscreen (fire and forget)
    setTimeout(() => {
      chrome.runtime
        .sendMessage({
          type: "reload-model",
          target: "offscreen",
          model: message.model,
        })
        .catch(() => {});
    }, 0);

    sendResponse({ success: true });
    return false; // Synchronous response
  }

  // Messages that don't need responses (fire and forget)
  if (message.type === "transcription-update") {
    // Forward to sidepanel
    setTimeout(() => {
      chrome.runtime
        .sendMessage({
          type: "display-transcription",
          data: message.data,
          processingTime: message.processingTime,
          realTimeRatio: message.realTimeRatio,
        })
        .catch(() => {});
    }, 0);
    return false; // No response needed
  }

  if (message.type === "processing-status") {
    // Forward to sidepanel
    setTimeout(() => {
      chrome.runtime
        .sendMessage({
          type: "processing-status",
          data: message.data,
        })
        .catch(() => {});
    }, 0);
    return false;
  }

  if (message.type === "model-status-update") {
    currentModelStatus = message.status;
    console.log("[Background] Model status updated to:", currentModelStatus);

    // Forward to sidepanel
    setTimeout(() => {
      chrome.runtime
        .sendMessage({
          type: "model-status-update",
          status: message.status,
        })
        .catch(() => {});
    }, 0);
    return false; // No response needed
  }

  if (message.type === "gpu-status-update") {
    currentGpuStatus = message.status;
    console.log("[Background] GPU status updated to:", currentGpuStatus);

    // Forward to sidepanel
    setTimeout(() => {
      chrome.runtime
        .sendMessage({
          type: "gpu-status-update",
          status: message.status,
        })
        .catch(() => {});
    }, 0);
    return false; // No response needed
  }

  if (message.type === "model-progress") {
    // Forward to sidepanel
    setTimeout(() => {
      chrome.runtime
        .sendMessage({
          type: "model-progress",
          data: message.data,
        })
        .catch(() => {});
    }, 0);
    return false; // No response needed
  }

  return false; // No response by default
});

async function startRecording(tabId, mode = "batch") {
  console.log(
    "[Background] startRecording called for tab:",
    tabId,
    "mode:",
    mode
  );

  if (isRecording) {
    console.log("[Background] Already recording, ignoring request");
    return;
  }

  try {
    console.log("[Background] Setting up offscreen document...");
    await setupOffscreenDocument();
    console.log("[Background] Offscreen document ready");

    console.log("[Background] Getting media stream ID...");
    const streamId = await chrome.tabCapture.getMediaStreamId({
      targetTabId: tabId,
    });
    console.log("[Background] Got stream ID:", streamId);

    console.log(
      "[Background] Sending start-capture to offscreen with mode:",
      mode
    );

    setTimeout(() => {
      chrome.runtime
        .sendMessage({
          type: "start-capture",
          target: "offscreen",
          data: { streamId, tabId, mode: mode },
        })
        .catch(() => {});
    }, 0);

    await new Promise((resolve) => setTimeout(resolve, 300));

    console.log("[Background] Assuming capture started");

    isRecording = true;

    await chrome.action.setBadgeText({ text: "REC" });
    await chrome.action.setBadgeBackgroundColor({ color: "#d93025" });
    console.log("[Background] Badge updated");

    setTimeout(() => {
      chrome.runtime
        .sendMessage({
          type: "recording-state-changed",
          isRecording: true,
        })
        .catch(() => {});
    }, 0);

    console.log("[Background] Recording started successfully");
  } catch (error) {
    console.error("[Background] Error in startRecording:", error);
    isRecording = false;
    throw error;
  }
}

async function stopRecording() {
  console.log("[Background] stopRecording called");

  if (!isRecording) {
    console.log("[Background] Not recording, ignoring request");
    return;
  }

  try {
    console.log("[Background] Sending stop-capture to offscreen...");

    setTimeout(() => {
      chrome.runtime
        .sendMessage({
          type: "stop-capture",
          target: "offscreen",
        })
        .catch(() => {});
    }, 0);

    isRecording = false;

    await chrome.action.setBadgeText({ text: "" });

    setTimeout(() => {
      chrome.runtime
        .sendMessage({
          type: "recording-state-changed",
          isRecording: false,
        })
        .catch(() => {});
    }, 0);

    console.log("[Background] Recording stopped successfully");
  } catch (error) {
    console.error("[Background] Error in stopRecording:", error);
    throw error;
  }
}

async function setupOffscreenDocument() {
  // Prevent duplicate creation
  if (offscreenInitializing) {
    console.log("[Background] Offscreen already initializing, waiting...");
    // Wait for initialization to complete
    while (offscreenInitializing) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return;
  }

  if (offscreenReady) {
    console.log("[Background] Offscreen already ready");
    return;
  }

  offscreenInitializing = true;

  try {
    console.log("[Background] Checking for existing offscreen document...");

    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
    });

    if (existingContexts.length > 0) {
      console.log("[Background] Offscreen document already exists");
      offscreenReady = true;
      offscreenInitializing = false;

      // Send init-model message in case it needs reinitializing
      const { selectedModel } = await chrome.storage.local.get([
        "selectedModel",
      ]);
      const modelName = selectedModel || "Xenova/whisper-tiny.en";

      console.log(
        "[Background] Sending init-model to existing offscreen:",
        modelName
      );

      setTimeout(() => {
        chrome.runtime
          .sendMessage({
            type: "init-model",
            target: "offscreen",
            model: modelName,
          })
          .catch(() => {});
      }, 100);

      return;
    }

    console.log("[Background] Creating new offscreen document...");
    await chrome.offscreen.createDocument({
      url: "offscreen/offscreen.html",
      reasons: ["USER_MEDIA"],
      justification: "Audio capture for transcription",
    });

    console.log("[Background] Offscreen document created");

    // Wait for offscreen to be ready
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Send selected model to offscreen
    const { selectedModel } = await chrome.storage.local.get(["selectedModel"]);
    const modelName = selectedModel || "Xenova/whisper-tiny.en";

    console.log("[Background] Sending init-model to offscreen:", modelName);

    setTimeout(() => {
      chrome.runtime
        .sendMessage({
          type: "init-model",
          target: "offscreen",
          model: modelName,
        })
        .catch((err) =>
          console.log("[Background] Init-model message failed:", err.message)
        );
    }, 500);

    offscreenReady = true;
    offscreenInitializing = false;

    console.log("[Background] Offscreen document ready");
  } catch (error) {
    console.error("[Background] Error in setupOffscreenDocument:", error);
    offscreenInitializing = false;
    throw error;
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  console.log("[Background] Extension installed/updated");
  try {
    await setupOffscreenDocument();
  } catch (error) {
    console.log(
      "[Background] Could not pre-create offscreen document:",
      error.message
    );
  }
});

// Also try to initialize when service worker starts (for browser restarts)
// But use a delay to avoid conflict with onInstalled
setTimeout(async () => {
  if (!offscreenReady && !offscreenInitializing) {
    console.log('[Background] Service worker started, initializing offscreen...');
    try {
      await setupOffscreenDocument();
    } catch (error) {
      console.log('[Background] Could not initialize offscreen on startup:', error.message);
    }
  }
}, 1000);

console.log('[Background] Background script initialization complete');