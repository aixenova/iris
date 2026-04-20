const GOOGLE_SHEET_WEB_APP_URL =
  "https://script.google.com/macros/s/AKfycbxyyi-aqpcnDynZJ_xxBiuZb_SyZ-O-pSjxvo3NaHpx_Sq3mwakV3Ootn3GvXbpsjaA/exec";
const STORAGE_KEYS = ["submissionHistory"];
const MAX_HISTORY_SIZE = 50;
const inFlightSubmissionIds = new Set();

async function getStoredSubmissions() {
  return globalThis.chrome.storage.local.get(STORAGE_KEYS);
}

async function saveStoredSubmissions(data) {
  await globalThis.chrome.storage.local.set(data);
}

async function storeSubmission(payload) {
  const { submissionHistory = [] } = await getStoredSubmissions();
  const updatedHistory = [payload, ...submissionHistory].slice(0, MAX_HISTORY_SIZE);

  await saveStoredSubmissions({
    submissionHistory: updatedHistory
  });
}

function getPendingSubmissions(submissionHistory) {
  return submissionHistory.filter((submission) => submission.sheetSync?.status === "pending");
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

function getConfiguredSheetUrl() {
  return GOOGLE_SHEET_WEB_APP_URL.trim();
}

async function appendSubmissionToSheet(payload) {
  const webAppUrl = getConfiguredSheetUrl();

  if (!webAppUrl) {
    throw new Error(
      "Google Sheet web app URL is not configured. Add it in background.js before reloading the extension."
    );
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
    await updateSubmissionSheetSync(payload.id, {
      status: "error",
      response: {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown sheet sync error."
      }
    });
  }
}

async function processPendingSubmission(payload) {
  if (!payload?.id || inFlightSubmissionIds.has(payload.id)) {
    return;
  }

  inFlightSubmissionIds.add(payload.id);

  try {
    const responseData = await appendSubmissionToSheet(payload);
    await updateSubmissionSheetSync(payload.id, {
      status: "success",
      response: responseData
    });
  } catch (error) {
    console.error("Prescription Submit Capture: sheet sync failed.", error);
    await updateSubmissionSheetSync(payload.id, {
      status: "error",
      response: {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown sheet sync error."
      }
    });
  } finally {
    inFlightSubmissionIds.delete(payload.id);
  }
}

async function syncPendingSubmissions() {
  const { submissionHistory = [] } = await getStoredSubmissions();
  const pendingSubmissions = getPendingSubmissions(submissionHistory);

  await Promise.all(pendingSubmissions.map((submission) => processPendingSubmission(submission)));
}

globalThis.chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
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

void syncPendingSubmissions();
