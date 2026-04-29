# Prescription Submit Capture

This Chrome extension captures values when the element with id `psyHomedosePrescription` is clicked.

It stores only:

- `patientId`
- `patientName`
- `selectedDays`

The popup shows the saved entries in a list view, with the newest submission first.

## Load In Chrome

1. Open `chrome://extensions`
2. Turn on **Developer mode**
3. Click **Load unpacked**
4. Select this folder:

`/Users/ayushganvir/Documents/iris-ext/iris`

## Configure Google Sheets Sync

The sheet write now runs from the extension background service worker instead of the page script. This is more reliable for cross-origin requests.
Pending sheet writes are rechecked when the popup opens and retried automatically in the background before they are marked as errors.

### 1. Create the sheet

1. Create a new Google Sheet
2. Rename the first sheet tab if you want, but keep note of its exact name
3. Add these headers in row 1:

`patientId | patientName | selectedDays | submissionId | createdAt`

### 2. Add the Apps Script

1. In the sheet, open `Extensions` -> `Apps Script`
2. Replace the default code with this:

```javascript
const SPREADSHEET_ID = "1YKdgpu5w5SK_CxIZlHYx3hufCUp5wym7cvsvTZpTvVM";
const SHEET_NAME = "Sheet1";

function jsonResponse(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  const lock = LockService.getScriptLock();
  let locked = false;

  try {
    lock.waitLock(30000);
    locked = true;

    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = spreadsheet.getSheetByName(SHEET_NAME);

    if (!sheet) {
      throw new Error("Sheet not found: " + SHEET_NAME);
    }

    const patientId = e.parameter.patientId || "";
    const patientName = e.parameter.patientName || "";
    const selectedDays = e.parameter.selectedDays || "";
    const submissionId = e.parameter.submissionId || "";

    if (submissionId && sheet.getLastRow() > 1) {
      const existingSubmissionIds = sheet
        .getRange(2, 4, sheet.getLastRow() - 1, 1)
        .getValues()
        .flat();

      if (existingSubmissionIds.includes(submissionId)) {
        return jsonResponse({
          ok: true,
          duplicate: true,
          submissionId
        });
      }
    }

    const createdAt = new Date();

    sheet.insertRowAfter(1);
    sheet.getRange(2, 1, 1, 5).setValues([[
      patientId,
      patientName,
      selectedDays,
      submissionId,
      createdAt
    ]]);

    return jsonResponse({
      ok: true,
      patientId,
      patientName,
      selectedDays,
      submissionId,
      createdAt: createdAt.toISOString()
    });
  } catch (error) {
    return jsonResponse({
      ok: false,
      error: String(error)
    });
  } finally {
    if (locked) {
      lock.releaseLock();
    }
  }
}
```

### 3. Deploy the script as a web app

1. Click `Deploy` -> `New deployment`
2. Choose type `Web app`
3. Set `Execute as` to `Me`
4. Set `Who has access` to `Anyone`
5. Click `Deploy`
6. Copy the generated web app URL

Important: if you edit the Apps Script later, use `Deploy` -> `Manage deployments` and update the existing web app deployment, then copy the latest URL again if Google gives you a new one.

### 4. Configure the web app URL in the extension

The extension includes a default Google Sheet web app URL, and you can override it from the popup without editing code.

1. Click the extension icon
2. Open `Settings`
3. Paste your deployed Apps Script web app URL into `Google Sheet Web App URL`
4. Enter the admin password
5. Click `Save`
6. Pending entries retry automatically with the saved URL

### 5. Test the sheet sync

1. Open the target webpage
2. Open Chrome DevTools if you want to watch logs
3. Click the button with id `psyHomedosePrescription`
4. Confirm the popup shows a new patient entry
5. Confirm a new row appears in your Google Sheet

If the popup updates but the sheet does not, open the extension's service worker logs from `chrome://extensions` -> your extension -> `service worker` to see the exact sync error.

## Files

- `manifest.json`: Extension config
- `content.js`: Captures and stores only the patient ID, name, and days
- `background.js`: Sends each captured entry to your Google Apps Script web app
- `popup.html`, `popup.js`, `popup.css`: Show the saved entries in a list view
