const GOOGLE_SHEET_WEB_APP_URL =
  "https://script.google.com/macros/s/AKfycbwomRvahklrms_Vc3wZSZkhGFr6FwjsqC7jUdvhyGXmMoo8H-8BY3qyM6pSdiW4Uj0x/exec";

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

  const response = await fetch(webAppUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`Google Sheet request failed with status ${response.status}`);
  }

  const rawResponse = await response.text();

  if (!rawResponse) {
    return;
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
}

globalThis.chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "appendSubmissionToSheet") {
    return false;
  }

  appendSubmissionToSheet(message.payload)
    .then(() => {
      sendResponse({ ok: true });
    })
    .catch((error) => {
      console.error("Prescription Submit Capture: sheet sync failed.", error);
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "Unknown sheet sync error."
      });
    });

  return true;
});
