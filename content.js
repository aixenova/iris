const STORAGE_KEYS = ["submissionHistory"];
const MAX_HISTORY_SIZE = 50;
const extensionStorage =
  typeof globalThis.chrome !== "undefined" ? globalThis.chrome?.storage?.local ?? null : null;

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
    patientId: extractLabeledValue(cells[0].innerText),
    patientName: extractLabeledValue(cells[1].innerText),
    selectedDays: dropdown ? dropdown.value : null
  };
}

function hasChromeStorage() {
  return Boolean(extensionStorage);
}

function readLocalFallback() {
  try {
    const submissionHistory = localStorage.getItem("submissionHistory");

    return {
      submissionHistory: submissionHistory ? JSON.parse(submissionHistory) : []
    };
  } catch (error) {
    console.warn("Prescription Submit Capture: localStorage read failed.", error);
    return {
      submissionHistory: []
    };
  }
}

async function getStoredSubmissions() {
  if (hasChromeStorage()) {
    return extensionStorage.get(STORAGE_KEYS);
  }

  return readLocalFallback();
}

async function saveStoredSubmissions(data) {
  if (hasChromeStorage()) {
    await extensionStorage.set(data);
    return;
  }

  try {
    localStorage.setItem("submissionHistory", JSON.stringify(data.submissionHistory));
  } catch (error) {
    console.warn("Prescription Submit Capture: localStorage write failed.", error);
  }
}

async function storeSubmission(payload) {
  const { submissionHistory = [] } = await getStoredSubmissions();
  const updatedHistory = [payload, ...submissionHistory].slice(0, MAX_HISTORY_SIZE);

  await saveStoredSubmissions({
    submissionHistory: updatedHistory
  });
}

function isInvalidatedExtensionContext(error) {
  return (
    error instanceof Error &&
    typeof error.message === "string" &&
    error.message.includes("Extension context invalidated")
  );
}

async function sendSubmissionToBackground(payload) {
  if (!globalThis.chrome?.runtime?.sendMessage) {
    return;
  }

  const response = await globalThis.chrome.runtime.sendMessage({
    type: "appendSubmissionToSheet",
    payload
  });

  if (!response?.ok) {
    throw new Error(response?.error || "Unknown sheet sync error.");
  }
}

document.addEventListener("click", async (event) => {
  const submitButton =
    event.target instanceof Element
      ? event.target.closest("#psyHomedosePrescription")
      : null;

  if (!submitButton) {
    return;
  }

  const payload = getSubmissionPayload();
  if (!payload) {
    return;
  }

  console.log("Prescription Submit Capture:", payload);

  try {
    await storeSubmission(payload);
    await sendSubmissionToBackground(payload);
  } catch (error) {
    if (isInvalidatedExtensionContext(error)) {
      console.warn(
        "Prescription Submit Capture: extension was reloaded. Refresh this page and try again."
      );
      return;
    }

    console.error("Prescription Submit Capture: failed during submit handling.", error);
  }
});
