const GOOGLE_SHEET_WEB_APP_URL =
  "https://script.google.com/macros/s/AKfycbzokan4HCIV1ijPDk0-dGoY5oebIjbrCTJhhpFfXPgaEBQmKGiLo0MYU02EsGcZdTfR/exec";
const STORAGE_KEYS = ["latestSubmission", "submissionHistory"];
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
    selectedDays: dropdown ? dropdown.value : null,
    pageTitle: document.title,
    url: window.location.href,
    capturedAt: new Date().toISOString()
  };
}

function hasChromeStorage() {
  return Boolean(extensionStorage);
}

function readLocalFallback() {
  try {
    const latestSubmission = localStorage.getItem("latestSubmission");
    const submissionHistory = localStorage.getItem("submissionHistory");

    return {
      latestSubmission: latestSubmission ? JSON.parse(latestSubmission) : null,
      submissionHistory: submissionHistory ? JSON.parse(submissionHistory) : []
    };
  } catch (error) {
    console.warn("Prescription Submit Capture: localStorage read failed.", error);
    return {
      latestSubmission: null,
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
    localStorage.setItem("latestSubmission", JSON.stringify(data.latestSubmission));
    localStorage.setItem("submissionHistory", JSON.stringify(data.submissionHistory));
  } catch (error) {
    console.warn("Prescription Submit Capture: localStorage write failed.", error);
  }
}

async function storeSubmission(payload) {
  const { submissionHistory = [] } = await getStoredSubmissions();
  const updatedHistory = [payload, ...submissionHistory].slice(0, 20);

  await saveStoredSubmissions({
    latestSubmission: payload,
    submissionHistory: updatedHistory
  });
}

function formatCurrentDate() {
  return new Date().toLocaleDateString("en-GB");
}

async function sendToGoogleSheet(payload) {
  const sheetPayload = {
    patientName: payload.patientName,
    patientId: payload.patientId,
    day: payload.selectedDays,
    currentDate: formatCurrentDate()
  };

  const response = await fetch(GOOGLE_SHEET_WEB_APP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=utf-8"
    },
    body: JSON.stringify(sheetPayload)
  });

  if (!response.ok) {
    throw new Error(`Google Sheet request failed with status ${response.status}`);
  }
}

function isInvalidatedExtensionContext(error) {
  return (
    error instanceof Error &&
    typeof error.message === "string" &&
    error.message.includes("Extension context invalidated")
  );
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
    await sendToGoogleSheet(payload);
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
