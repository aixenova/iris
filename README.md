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

### 1. Create the sheet

1. Create a new Google Sheet
2. Rename the first sheet tab if you want, but keep note of its exact name
3. Add these headers in row 1:

`patientId | patientName | selectedDays | createdAt`

### 2. Add the Apps Script

1. In the sheet, open `Extensions` -> `Apps Script`
2. Replace the default code with this:

```javascript
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents || "{}");
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];

    sheet.appendRow([
      data.patientId || "",
      data.patientName || "",
      data.selectedDays || "",
      new Date()
    ]);

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: String(error) }))
      .setMimeType(ContentService.MimeType.JSON);
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

### 4. Paste the web app URL into the extension

1. Open [background.js](/Users/ayushganvir/Documents/iris-ext/iris/background.js)
2. Replace the empty string in `GOOGLE_SHEET_WEB_APP_URL` with your deployed web app URL:

```javascript
const GOOGLE_SHEET_WEB_APP_URL = "https://script.google.com/macros/s/your-deployment-id/exec";
```

3. Save the file
4. Go back to `chrome://extensions`
5. Click `Reload` on the extension

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
