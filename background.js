const DEFAULT_GOOGLE_SHEET_WEB_APP_URL =
  "https://script.google.com/macros/s/PASTE_DEPLOYMENT_ID_HERE/exec";
const STORAGE_KEYS = ["submissionHistory", "googleSheetWebAppUrl"];
const MAX_HISTORY_SIZE = 50;
const MAX_SHEET_SYNC_ATTEMPTS = 5;
const SHEET_SYNC_RETRY_DELAYS_MS = [2_000, 10_000, 30_000, 60_000, 120_000];
const SHEET_SYNC_RETRY_ALARM = "retryPendingSheetSync";
const SETTINGS_PASSWORD = "irisadmin";
const inFlightSubmissionIds = new Set();

async function getStoredSubmissions() {
  return globalThis.chrome.storage.local.get(STORAGE_KEYS);
}

async function saveStoredSubmissions(data) {
  await globalThis.chrome.storage.local.set(data);
}

async function storeSubmission(payload) {
  const { submissionHistory = [] } = await getStoredSubmissions();
  const updatedHistory = trimSubmissionHistory([payload, ...submissionHistory]);

  await saveStoredSubmissions({
    submissionHistory: updatedHistory
  });
}

function getPendingSubmissions(submissionHistory) {
  return submissionHistory.filter((submission) => submission.sheetSync?.status === "pending");
}

function trimSubmissionHistory(submissionHistory) {
  if (submissionHistory.length <= MAX_HISTORY_SIZE) {
    return submissionHistory;
  }

  const pendingSubmissionCount = getPendingSubmissions(submissionHistory).length;
  const completedSubmissionLimit = Math.max(MAX_HISTORY_SIZE - pendingSubmissionCount, 0);
  let completedSubmissionCount = 0;

  return submissionHistory.filter((submission) => {
    if (submission.sheetSync?.status === "pending") {
      return true;
    }

    if (completedSubmissionCount >= completedSubmissionLimit) {
      return false;
    }

    completedSubmissionCount += 1;
    return true;
  });
}

function getRetryDelayMs(attempts) {
  return (
    SHEET_SYNC_RETRY_DELAYS_MS[Math.min(attempts - 1, SHEET_SYNC_RETRY_DELAYS_MS.length - 1)] ||
    SHEET_SYNC_RETRY_DELAYS_MS[0]
  );
}

function isSubmissionDueForSync(submission, now = Date.now()) {
  const nextRetryAt = submission.sheetSync?.nextRetryAt;

  return !nextRetryAt || nextRetryAt <= now;
}

async function schedulePendingSubmissionRetry() {
  if (!globalThis.chrome?.alarms?.create) {
    return;
  }

  const { submissionHistory = [] } = await getStoredSubmissions();
  const pendingRetryAtTimes = getPendingSubmissions(submissionHistory)
    .map((submission) => submission.sheetSync?.nextRetryAt)
    .filter((nextRetryAt) => typeof nextRetryAt === "number");

  if (!pendingRetryAtTimes.length) {
    await globalThis.chrome.alarms.clear(SHEET_SYNC_RETRY_ALARM);
    return;
  }

  globalThis.chrome.alarms.create(SHEET_SYNC_RETRY_ALARM, {
    when: Math.max(Date.now() + 1_000, Math.min(...pendingRetryAtTimes))
  });
}

async function updateSubmissionSheetSync(submissionId, sheetSync) {
  const { submissionHistory = [] } = await getStoredSubmissions();
  const updatedHistory = submissionHistory.map((submission) => {
    if (submission.id !== submissionId) {
      return submission;
    }

    return {
      ...submission,
      sheetSync
    };
  });

  await saveStoredSubmissions({
    submissionHistory: updatedHistory
  });
}

async function getConfiguredSheetUrl() {
  const { googleSheetWebAppUrl } = await getStoredSubmissions();
  return (googleSheetWebAppUrl || DEFAULT_GOOGLE_SHEET_WEB_APP_URL).trim();
}

async function appendSubmissionToSheet(payload) {
  const webAppUrl = await getConfiguredSheetUrl();

  if (!webAppUrl) {
    throw new Error("Google Sheet web app URL is not configured.");
  }

  if (!webAppUrl.startsWith("https://script.google.com/macros/s/")) {
    throw new Error("Google Sheet web app URL must be a deployed Apps Script web app URL.");
  }

  const requestUrl = new URL(webAppUrl);
  requestUrl.searchParams.set("patientId", payload.patientId || "");
  requestUrl.searchParams.set("patientName", payload.patientName || "");
  requestUrl.searchParams.set("selectedDays", payload.selectedDays || "");
  requestUrl.searchParams.set("submissionId", payload.id || "");

  const response = await fetch(requestUrl.toString(), {
    method: "GET"
  });

  if (!response.ok) {
    throw new Error(`Google Sheet request failed with status ${response.status}`);
  }

  const rawResponse = await response.text();

  if (!rawResponse) {
    return { ok: true };
  }

  let parsedResponse;

  try {
    parsedResponse = JSON.parse(rawResponse);
  } catch (error) {
    throw new Error("Google Sheet response was not valid JSON.");
  }

  if (parsedResponse.ok === false) {
    throw new Error(parsedResponse.error || "Google Sheet script returned an error.");
  }

  return parsedResponse;
}

async function requestSheetAction(action) {
  const webAppUrl = await getConfiguredSheetUrl();

  if (!webAppUrl) {
    throw new Error("Google Sheet web app URL is not configured.");
  }

  if (!webAppUrl.startsWith("https://script.google.com/macros/s/")) {
    throw new Error("Google Sheet web app URL must be a deployed Apps Script web app URL.");
  }

  const requestUrl = new URL(webAppUrl);
  requestUrl.searchParams.set("action", action);

  const response = await fetch(requestUrl.toString(), {
    method: "GET"
  });

  if (!response.ok) {
    throw new Error(`Google Sheet request failed with status ${response.status}`);
  }

  const rawResponse = await response.text();

  if (!rawResponse) {
    return { ok: true };
  }

  let parsedResponse;

  try {
    parsedResponse = JSON.parse(rawResponse);
  } catch (error) {
    throw new Error("Google Sheet response was not valid JSON.");
  }

  if (parsedResponse.ok === false) {
    throw new Error(parsedResponse.error || "Google Sheet script returned an error.");
  }

  return parsedResponse;
}

async function requestSheetTextAction(action) {
  const webAppUrl = await getConfiguredSheetUrl();

  if (!webAppUrl) {
    throw new Error("Google Sheet web app URL is not configured.");
  }

  if (!webAppUrl.startsWith("https://script.google.com/macros/s/")) {
    throw new Error("Google Sheet web app URL must be a deployed Apps Script web app URL.");
  }

  const requestUrl = new URL(webAppUrl);
  requestUrl.searchParams.set("action", action);

  const response = await fetch(requestUrl.toString(), {
    method: "GET"
  });

  if (!response.ok) {
    throw new Error(`Google Sheet request failed with status ${response.status}`);
  }

  return response.text();
}

function getTomorrowFileDate() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow.toISOString().slice(0, 10);
}

async function downloadTomorrowFollowUpsCsv() {
  if (!globalThis.chrome?.downloads?.download) {
    throw new Error("Chrome downloads permission is unavailable.");
  }

  const csv = await requestSheetTextAction("exportTomorrowFollowUpsCsv");
  const dataUrl = `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;

  return globalThis.chrome.downloads.download({
    url: dataUrl,
    filename: `tomorrow-follow-ups-${getTomorrowFileDate()}.csv`,
    saveAs: true
  });
}

async function handleCapturedSubmission(payload) {
  await storeSubmission(payload);

  try {
    const responseData = await appendSubmissionToSheet(payload);
    await updateSubmissionSheetSync(payload.id, {
      status: "success",
      response: responseData
    });
  } catch (error) {
    console.error("Prescription Submit Capture: sheet sync failed.", error);
    const attempts = (payload.sheetSync?.attempts || 0) + 1;

    if (attempts < MAX_SHEET_SYNC_ATTEMPTS) {
      await updateSubmissionSheetSync(payload.id, {
        status: "pending",
        attempts,
        lastAttemptAt: Date.now(),
        nextRetryAt: Date.now() + getRetryDelayMs(attempts),
        response: {
          ok: false,
          error: error instanceof Error ? error.message : "Unknown sheet sync error."
        }
      });
      await schedulePendingSubmissionRetry();
      return;
    }

    await updateSubmissionSheetSync(payload.id, {
      status: "error",
      attempts,
      lastAttemptAt: Date.now(),
      response: {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown sheet sync error."
      }
    });
  }
}

async function processPendingSubmission(payload) {
  if (!payload?.id || inFlightSubmissionIds.has(payload.id) || !isSubmissionDueForSync(payload)) {
    return;
  }

  inFlightSubmissionIds.add(payload.id);
  const attempts = (payload.sheetSync?.attempts || 0) + 1;

  try {
    const responseData = await appendSubmissionToSheet(payload);
    await updateSubmissionSheetSync(payload.id, {
      status: "success",
      attempts,
      lastAttemptAt: Date.now(),
      response: responseData
    });
  } catch (error) {
    console.error("Prescription Submit Capture: sheet sync failed.", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown sheet sync error.";

    if (attempts < MAX_SHEET_SYNC_ATTEMPTS) {
      await updateSubmissionSheetSync(payload.id, {
        status: "pending",
        attempts,
        lastAttemptAt: Date.now(),
        nextRetryAt: Date.now() + getRetryDelayMs(attempts),
        response: {
          ok: false,
          error: errorMessage
        }
      });
      await schedulePendingSubmissionRetry();
      return;
    }

    await updateSubmissionSheetSync(payload.id, {
      status: "error",
      attempts,
      lastAttemptAt: Date.now(),
      response: {
        ok: false,
        error: errorMessage
      }
    });
  } finally {
    inFlightSubmissionIds.delete(payload.id);
  }
}

async function syncPendingSubmissions() {
  const { submissionHistory = [] } = await getStoredSubmissions();
  const pendingSubmissions = getPendingSubmissions(submissionHistory).filter((submission) =>
    isSubmissionDueForSync(submission)
  );

  await Promise.all(pendingSubmissions.map((submission) => processPendingSubmission(submission)));
  await schedulePendingSubmissionRetry();
}

globalThis.chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "getSheetSettings") {
    getStoredSubmissions()
      .then(({ googleSheetWebAppUrl }) => {
        sendResponse({
          ok: true,
          defaultGoogleSheetWebAppUrl: DEFAULT_GOOGLE_SHEET_WEB_APP_URL,
          googleSheetWebAppUrl: googleSheetWebAppUrl || DEFAULT_GOOGLE_SHEET_WEB_APP_URL
        });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Unknown settings error."
        });
      });

    return true;
  }

  if (message?.type === "saveSheetSettings") {
    const googleSheetWebAppUrl = String(message.googleSheetWebAppUrl || "").trim();
    const adminPassword = String(message.adminPassword || "");

    if (adminPassword !== SETTINGS_PASSWORD) {
      sendResponse({
        ok: false,
        error: "Invalid admin password."
      });
      return false;
    }

    if (!googleSheetWebAppUrl.startsWith("https://script.google.com/macros/s/")) {
      sendResponse({
        ok: false,
        error: "Enter a valid deployed Apps Script web app URL."
      });
      return false;
    }

    saveStoredSubmissions({ googleSheetWebAppUrl })
      .then(() => syncPendingSubmissions())
      .then(() => {
        sendResponse({ ok: true, googleSheetWebAppUrl });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Unknown settings error."
        });
      });

    return true;
  }

  if (message?.type === "captureSubmission") {
    handleCapturedSubmission(message.payload)
      .then(() => {
        sendResponse({ ok: true });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Unknown capture error."
        });
      });

    return true;
  }

  if (message?.type === "syncAllSheetRows") {
    requestSheetAction("syncAllRows")
      .then((response) => {
        sendResponse({ ok: true, response });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Unknown sheet sync error."
        });
      });

    return true;
  }

  if (message?.type === "refreshTomorrowFollowUps") {
    requestSheetAction("refreshTomorrowFollowUps")
      .then((response) => {
        sendResponse({ ok: true, response });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Unknown tomorrow follow-up error."
        });
      });

    return true;
  }

  if (message?.type === "downloadTomorrowFollowUpsCsv") {
    downloadTomorrowFollowUpsCsv()
      .then((downloadId) => {
        sendResponse({ ok: true, downloadId });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Unknown download error."
        });
      });

    return true;
  }

  if (message?.type !== "syncPendingSubmissions") {
    return false;
  }

  syncPendingSubmissions()
    .then(() => {
      sendResponse({ ok: true });
    })
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "Unknown capture error."
      });
    });

  return true;
});

globalThis.chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes.submissionHistory) {
    return;
  }

  void syncPendingSubmissions();
});

if (globalThis.chrome?.alarms?.onAlarm) {
  globalThis.chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === SHEET_SYNC_RETRY_ALARM) {
      void syncPendingSubmissions();
    }
  });
}

void syncPendingSubmissions();
