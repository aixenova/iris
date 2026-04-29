const STORAGE_KEYS = ["submissionHistory"];
const MAX_HISTORY_SIZE = 50;
const extensionStorage =
  typeof globalThis.chrome !== "undefined" ? globalThis.chrome?.storage?.local ?? null : null;
const sentSubmissionKeys = new Set();

function createSubmissionId() {
  return `submission-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function extractLabeledValue(text) {
  if (!text) {
    return null;
  }

  const parts = text.split(":");
  if (parts.length < 2) {
    return text.trim() || null;
  }

  return parts.slice(1).join(":").trim() || null;
}

function getSubmissionPayload() {
  const row = document.querySelector(".subtabletitle");
  const dropdown = document.getElementById("nextfollowup");

  if (!row) {
    console.warn("Prescription Submit Capture: .subtabletitle row not found.");
    return null;
  }

  const cells = row.querySelectorAll("td");
  if (cells.length < 2) {
    console.warn("Prescription Submit Capture: expected at least two table cells.");
    return null;
  }

  return {
    id: createSubmissionId(),
    patientId: extractLabeledValue(cells[0].innerText),
    patientName: extractLabeledValue(cells[1].innerText),
    selectedDays: dropdown ? dropdown.value : null,
    sheetSync: {
      status: "pending",
      response: null
    }
  };
}

function isInvalidatedExtensionContext(error) {
  return (
    error instanceof Error &&
    typeof error.message === "string" &&
    error.message.includes("Extension context invalidated")
  );
}

async function getStoredSubmissions() {
  if (extensionStorage) {
    return extensionStorage.get(STORAGE_KEYS);
  }

  return { submissionHistory: [] };
}

async function saveStoredSubmissions(data) {
  if (!extensionStorage) {
    return;
  }

  await extensionStorage.set(data);
}

async function storePendingSubmission(payload) {
  const { submissionHistory = [] } = await getStoredSubmissions();
  const withoutDuplicate = submissionHistory.filter((submission) => submission.id !== payload.id);
  const updatedHistory = [payload, ...withoutDuplicate].slice(0, MAX_HISTORY_SIZE);

  await saveStoredSubmissions({
    submissionHistory: updatedHistory
  });
}

function getSubmissionKey(payload) {
  return [payload.patientId || "", payload.patientName || "", payload.selectedDays || ""].join("|");
}

function isDuplicateRecentSubmission(payload) {
  const submissionKey = getSubmissionKey(payload);

  if (sentSubmissionKeys.has(submissionKey)) {
    return true;
  }

  sentSubmissionKeys.add(submissionKey);
  setTimeout(() => {
    sentSubmissionKeys.delete(submissionKey);
  }, 3_000);

  return false;
}

function sendSubmissionToBackground(payload) {
  if (!globalThis.chrome?.runtime?.sendMessage) {
    return Promise.resolve({ ok: false, error: "Chrome runtime messaging is unavailable." });
  }

  return globalThis.chrome.runtime.sendMessage({
    type: "captureSubmission",
    payload
  });
}

async function captureSubmission() {
  const payload = getSubmissionPayload();

  if (!payload || isDuplicateRecentSubmission(payload)) {
    return;
  }

  console.log("Prescription Submit Capture:", payload);

  try {
    await sendSubmissionToBackground(payload);
  } catch (error) {
    if (isInvalidatedExtensionContext(error)) {
      console.warn(
        "Prescription Submit Capture: extension was reloaded. Refresh this page and try again."
      );
      return;
    }

    console.warn(
      "Prescription Submit Capture: background capture failed; saving pending submission locally.",
      error
    );

    try {
      await storePendingSubmission(payload);
    } catch (storageError) {
      console.error("Prescription Submit Capture: failed during submit handling.", storageError);
    }
  }
}

document.addEventListener(
  "click",
  (event) => {
    const submitButton =
      event.target instanceof Element
        ? event.target.closest("#psyHomedosePrescription")
        : null;

    if (!submitButton) {
      return;
    }

    void captureSubmission();
  },
  true
);

document.addEventListener(
  "submit",
  (event) => {
    if (!(event.target instanceof HTMLFormElement)) {
      return;
    }

    if (!event.target.querySelector("#psyHomedosePrescription")) {
      return;
    }

    void captureSubmission();
  },
  true
);

globalThis.addEventListener("pagehide", () => {
  const submitButton = document.activeElement?.closest?.("#psyHomedosePrescription");

  if (!submitButton) {
    return;
  }

  void captureSubmission();
});
