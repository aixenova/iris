const statusEl = document.getElementById("status");
const metaEl = document.getElementById("meta");
const entryListEl = document.getElementById("entryList");
const emptyStateEl = document.getElementById("emptyState");
const sheetUrlInputEl = document.getElementById("sheetUrlInput");
const settingsPasswordInputEl = document.getElementById("settingsPasswordInput");
const saveSheetUrlButtonEl = document.getElementById("saveSheetUrlButton");
const settingsStatusEl = document.getElementById("settingsStatus");
const syncAllRowsButtonEl = document.getElementById("syncAllRowsButton");
const refreshTomorrowButtonEl = document.getElementById("refreshTomorrowButton");
const downloadTomorrowButtonEl = document.getElementById("downloadTomorrowButton");
const bulkSyncStatusEl = document.getElementById("bulkSyncStatus");
const popupStorage =
  typeof globalThis.chrome !== "undefined" ? globalThis.chrome?.storage?.local ?? null : null;

function readPopupFallback() {
  try {
    const submissionHistory = localStorage.getItem("submissionHistory");

    return {
      submissionHistory: submissionHistory ? JSON.parse(submissionHistory) : []
    };
  } catch (error) {
    console.warn("Prescription Submit Capture: popup localStorage read failed.", error);
    return {
      submissionHistory: []
    };
  }
}

function createEntryItem(submission, index) {
  const item = document.createElement("li");
  item.className = "entry-item";

  const title = document.createElement("div");
  title.className = "entry-title";
  title.textContent = submission.patientName || "Unknown patient";

  const detailRow = document.createElement("div");
  detailRow.className = "entry-details";

  const patientId = document.createElement("span");
  patientId.textContent = submission.patientId || "No patient ID";

  const days = document.createElement("span");
  days.textContent = submission.selectedDays
    ? `${submission.selectedDays} day(s)`
    : "No days selected";

  const order = document.createElement("span");
  order.textContent = `#${index + 1}`;

  const syncState = document.createElement("span");
  syncState.className = `sync-pill sync-pill-${submission.sheetSync?.status || "pending"}`;
  syncState.textContent =
    submission.sheetSync?.status === "success"
      ? "Sheet synced"
      : submission.sheetSync?.status === "error"
        ? "Sheet error"
        : "Sheet pending";

  detailRow.append(patientId, days, order);
  item.append(title, detailRow, syncState);

  const responseToggle = document.createElement("details");
  responseToggle.className = "entry-response";

  const responseSummary = document.createElement("summary");
  responseSummary.textContent = "View Google Sheet response";

  const responsePre = document.createElement("pre");
  responsePre.className = "response-code";
  responsePre.textContent = JSON.stringify(
    submission.sheetSync?.response || {
      status: submission.sheetSync?.status || "pending",
      message: "Waiting for a Google Sheet response."
    },
    null,
    2
  );

  responseToggle.append(responseSummary, responsePre);
  item.append(responseToggle);

  return item;
}

function renderSubmissionList(submissionHistory) {
  entryListEl.replaceChildren();

  if (!submissionHistory.length) {
    statusEl.textContent = "Waiting for the first captured submit...";
    metaEl.textContent = "";
    emptyStateEl.hidden = false;
    return;
  }

  statusEl.textContent = "Recent submissions";
  metaEl.textContent = `${submissionHistory.length} entr${
    submissionHistory.length === 1 ? "y" : "ies"
  } saved`;
  emptyStateEl.hidden = true;

  submissionHistory.forEach((submission, index) => {
    entryListEl.append(createEntryItem(submission, index));
  });
}

function setSettingsStatus(message, status = "neutral") {
  settingsStatusEl.textContent = message;
  settingsStatusEl.dataset.status = status;
}

function setBulkSyncStatus(message, status = "neutral") {
  bulkSyncStatusEl.textContent = message;
  bulkSyncStatusEl.dataset.status = status;
}

async function sendRuntimeMessage(message) {
  if (!globalThis.chrome?.runtime?.sendMessage) {
    return { ok: false, error: "Chrome runtime messaging is unavailable." };
  }

  return globalThis.chrome.runtime.sendMessage(message);
}

async function loadSheetSettings() {
  const response = await sendRuntimeMessage({
    type: "getSheetSettings"
  });

  if (!response?.ok) {
    setSettingsStatus(response?.error || "Could not load sheet settings.", "error");
    return;
  }

  sheetUrlInputEl.value = response.googleSheetWebAppUrl || response.defaultGoogleSheetWebAppUrl || "";
  setSettingsStatus("Using saved sheet endpoint.", "success");
}

async function saveSheetSettings() {
  const googleSheetWebAppUrl = sheetUrlInputEl.value.trim();
  const adminPassword = settingsPasswordInputEl.value;

  saveSheetUrlButtonEl.disabled = true;
  setSettingsStatus("Saving...", "neutral");

  try {
    const response = await sendRuntimeMessage({
      type: "saveSheetSettings",
      googleSheetWebAppUrl,
      adminPassword
    });

    if (!response?.ok) {
      setSettingsStatus(response?.error || "Could not save sheet settings.", "error");
      return;
    }

    sheetUrlInputEl.value = response.googleSheetWebAppUrl;
    settingsPasswordInputEl.value = "";
    setSettingsStatus("Saved. Pending entries will retry with this URL.", "success");
    await loadSubmissionList();
  } catch (error) {
    setSettingsStatus(error instanceof Error ? error.message : "Could not save sheet settings.", "error");
  } finally {
    saveSheetUrlButtonEl.disabled = false;
  }
}

async function syncAllRows() {
  syncAllRowsButtonEl.disabled = true;
  setBulkSyncStatus("Syncing Extension data into All Contacts...", "neutral");

  try {
    const response = await sendRuntimeMessage({
      type: "syncAllSheetRows"
    });

    if (!response?.ok) {
      setBulkSyncStatus(response?.error || "Could not sync all rows.", "error");
      return;
    }

    const syncResponse = response.response || {};
    setBulkSyncStatus(
      `Synced ${syncResponse.matchedRows || 0} row(s). ${syncResponse.unmatchedRows || 0} unmatched.`,
      "success"
    );
  } catch (error) {
    setBulkSyncStatus(error instanceof Error ? error.message : "Could not sync all rows.", "error");
  } finally {
    syncAllRowsButtonEl.disabled = false;
  }
}

async function refreshTomorrowFollowUps() {
  refreshTomorrowButtonEl.disabled = true;
  setBulkSyncStatus("Refreshing Tomorrow Follow-ups...", "neutral");

  try {
    const response = await sendRuntimeMessage({
      type: "refreshTomorrowFollowUps"
    });

    if (!response?.ok) {
      setBulkSyncStatus(response?.error || "Could not refresh tomorrow follow-ups.", "error");
      return;
    }

    const followUps = response.response?.followUps || {};
    setBulkSyncStatus(
      `Tomorrow Follow-ups ready: ${followUps.rowCount || 0} row(s).`,
      "success"
    );
  } catch (error) {
    setBulkSyncStatus(
      error instanceof Error ? error.message : "Could not refresh tomorrow follow-ups.",
      "error"
    );
  } finally {
    refreshTomorrowButtonEl.disabled = false;
  }
}

async function downloadTomorrowFollowUps() {
  downloadTomorrowButtonEl.disabled = true;
  setBulkSyncStatus("Preparing Excel CSV download...", "neutral");

  try {
    const response = await sendRuntimeMessage({
      type: "downloadTomorrowFollowUpsCsv"
    });

    if (!response?.ok) {
      setBulkSyncStatus(response?.error || "Could not download tomorrow follow-ups.", "error");
      return;
    }

    setBulkSyncStatus("Download started.", "success");
  } catch (error) {
    setBulkSyncStatus(
      error instanceof Error ? error.message : "Could not download tomorrow follow-ups.",
      "error"
    );
  } finally {
    downloadTomorrowButtonEl.disabled = false;
  }
}

async function loadSubmissionList() {
  if (globalThis.chrome?.runtime?.sendMessage) {
    sendRuntimeMessage({
      type: "syncPendingSubmissions"
    }).catch((error) => {
      console.warn("Prescription Submit Capture: failed to recheck pending submissions.", error);
    });
  }

  const stored = popupStorage
    ? await popupStorage.get(["submissionHistory"])
    : readPopupFallback();
  const { submissionHistory = [] } = stored;

  renderSubmissionList(submissionHistory);
}

saveSheetUrlButtonEl.addEventListener("click", () => {
  void saveSheetSettings();
});

syncAllRowsButtonEl.addEventListener("click", () => {
  void syncAllRows();
});

refreshTomorrowButtonEl.addEventListener("click", () => {
  void refreshTomorrowFollowUps();
});

downloadTomorrowButtonEl.addEventListener("click", () => {
  void downloadTomorrowFollowUps();
});

sheetUrlInputEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    void saveSheetSettings();
  }
});

if (popupStorage && globalThis.chrome?.storage?.onChanged) {
  globalThis.chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") {
      return;
    }

    if (changes.submissionHistory) {
      loadSubmissionList();
    }
  });
}

loadSheetSettings();
loadSubmissionList();
