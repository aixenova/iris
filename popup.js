const statusEl = document.getElementById("status");
const metaEl = document.getElementById("meta");
const entryListEl = document.getElementById("entryList");
const emptyStateEl = document.getElementById("emptyState");
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

  detailRow.append(patientId, days, order);
  item.append(title, detailRow);

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

async function loadSubmissionList() {
  const stored = popupStorage
    ? await popupStorage.get(["submissionHistory"])
    : readPopupFallback();
  const { submissionHistory = [] } = stored;

  renderSubmissionList(submissionHistory);
}

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

loadSubmissionList();
