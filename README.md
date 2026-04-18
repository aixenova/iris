# Prescription Submit Capture

This Chrome extension captures values when the element with id `psyHomedosePrescription` is clicked.

It stores:

- `patientId`
- `patientName`
- `selectedDays`
- page URL
- page title
- capture timestamp

## Load in Chrome

1. Open `chrome://extensions`
2. Turn on **Developer mode**
3. Click **Load unpacked**
4. Select this folder:

`/Users/asixaditya/Documents/Codex/2026-04-18-i-want-to-build-a-chrome-3`

## Files

- `manifest.json`: Extension config
- `content.js`: Captures and stores the values from the webpage
- `popup.html`, `popup.js`, `popup.css`: Shows the latest stored payload
