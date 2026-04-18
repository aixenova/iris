const statusEl = document.getElementById("status");
const metaEl = document.getElementById("meta");
const patientNameEl = document.getElementById("patientName");
const patientIdEl = document.getElementById("patientId");
const selectedDaysEl = document.getElementById("selectedDays");
const capturedAtEl = document.getElementById("capturedAt");
const pageTitleEl = document.getElementById("pageTitle");
const pageUrlEl = document.getElementById("pageUrl");
const popupStorage =
  typeof globalThis.chrome !== "undefined" ? globalThis.chrome?.storage?.local ?? null : null;

function readPopupFallback() {
  try {
    const latestSubmission = localStorage.getItem("latestSubmission");
    const submissionHistory = localStorage.getItem("submissionHistory");

    return {
      latestSubmission: latestSubmission ? JSON.parse(latestSubmission) : null,
      submissionHistory: submissionHistory ? JSON.parse(submissionHistory) : []
    };
  } catch (error) {
    console.warn("Prescription Submit Capture: popup localStorage read failed.", error);
    return {
      latestSubmission: null,
      submissionHistory: []
    };
  }
}

function setField(element, value, fallback = "Not available") {
  element.textContent = value || fallback;
}

function renderSubmission(submission, historyLength) {
  if (!submission) {
    statusEl.textContent = "Waiting for a captured submit...";
    metaEl.textContent = "";
    setField(patientNameEl, null);
    setField(patientIdEl, null);
    setField(selectedDaysEl, null);
    setField(capturedAtEl, null);
    setField(pageTitleEl, null);
    setField(pageUrlEl, null);
    return;
  }

  statusEl.textContent = "Latest submit captured successfully.";
  metaEl.textContent = `${historyLength} entr${historyLength === 1 ? "y" : "ies"} saved`;
  setField(patientNameEl, submission.patientName);
  setField(patientIdEl, submission.patientId);
  setField(
    selectedDaysEl,
    submission.selectedDays ? `${submission.selectedDays} day(s)` : null
  );
  setField(
    capturedAtEl,
    submission.capturedAt ? new Date(submission.capturedAt).toLocaleString() : null
  );
  setField(pageTitleEl, submission.pageTitle);
  setField(pageUrlEl, submission.url);
}

async function loadSubmission() {
  const stored = popupStorage
    ? await popupStorage.get(["latestSubmission", "submissionHistory"])
    : readPopupFallback();
  const { latestSubmission = null, submissionHistory = [] } = stored;

  renderSubmission(latestSubmission, submissionHistory.length);
}

if (popupStorage && globalThis.chrome?.storage?.onChanged) {
  globalThis.chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") {
      return;
    }

    if (changes.latestSubmission || changes.submissionHistory) {
      loadSubmission();
    }
  });
}

loadSubmission();
