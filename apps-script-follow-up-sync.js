const SPREADSHEET_ID = "1YKdgpu5w5SK_CxIZlHYx3hufCUp5wym7cvsvTZpTvVM";
const EXTENSION_SHEET_NAME = "Extension data";
const PATIENT_SHEET_NAME = "All Contacts";
const TOMORROW_FOLLOWUPS_SHEET_NAME = "Tomorrow Follow-ups";
const SCHEDULED_SYNC_FUNCTION_NAME = "scheduledSyncAllRows";
const SCHEDULED_TOMORROW_FOLLOWUPS_FUNCTION_NAME = "scheduledRefreshTomorrowFollowUps";
const TIMEZONE = "Asia/Kolkata";
const FOLLOWUP_EMAIL_RECIPIENTS = "";

const EXTENSION_COLUMNS = {
  patientId: 1,
  patientName: 2,
  selectedDays: 3,
  submissionId: 4,
  createdAt: 5,
  phoneNo: 6,
  dNo: 7,
  followUpDate: 8
};

const ALL_DATA_COLUMNS = {
  uidPrimary: 1,
  id: 2,
  uidSecondary: 3,
  adharNumber: 4,
  patientName: 5,
  mobileNumber: 6,
  age: 7,
  address: 8,
  patientVisitDate: 9,
  visitDay: 10,
  followUpDate: 11,
  followUpDay: 12,
  callingPatient: 13
};

function jsonResponse(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON
  );
}

function csvResponse(csv) {
  return ContentService.createTextOutput(csv).setMimeType(ContentService.MimeType.CSV);
}

function normalizeId(value) {
  return String(value || "").trim();
}

function normalizeIdDigits(value) {
  return normalizeId(value).replace(/\D/g, "");
}

function asSelectedDays(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : normalizeId(value);
}

function asDateValue(value) {
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value : new Date();
}

function asExistingDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  const parsedDate = new Date(value);
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
}

function addDays(date, days) {
  const nextDate = new Date(date.getTime());
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
}

function dateKey(date) {
  return Utilities.formatDate(date, TIMEZONE, "yyyy-MM-dd");
}

function getTomorrowDate() {
  return addDays(new Date(), 1);
}

function getAdjustedFollowUpDate(visitDate, selectedDays) {
  const numericDays = Number(selectedDays);

  if (!visitDate || !Number.isFinite(numericDays)) {
    return null;
  }

  const followUpDate = addDays(visitDate, numericDays);

  if (followUpDate.getDay() === 0) {
    return addDays(followUpDate, 1);
  }

  return followUpDate;
}

function escapeCsvValue(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, TIMEZONE, "yyyy-MM-dd HH:mm:ss");
  }

  const text = String(value == null ? "" : value);
  return /[",\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function rowsToCsv(rows) {
  return rows.map((row) => row.map(escapeCsvValue).join(",")).join("\n");
}

function findTextInColumn(sheet, column, value, matchEntireCell) {
  const lastRow = sheet.getLastRow();
  const normalizedValue = normalizeId(value);

  if (lastRow < 2 || !normalizedValue) {
    return null;
  }

  const match = sheet
    .getRange(2, column, lastRow - 1, 1)
    .createTextFinder(normalizedValue)
    .matchEntireCell(matchEntireCell)
    .findNext();

  return match ? match.getRow() : null;
}

function findDuplicateSubmissionRow(sheet, submissionId) {
  return findTextInColumn(sheet, EXTENSION_COLUMNS.submissionId, submissionId, true);
}

function isDuplicateSubmission(sheet, submissionId) {
  return findDuplicateSubmissionRow(sheet, submissionId) !== null;
}

function findPatientRow(patientSheet, patientId) {
  const normalizedPatientId = normalizeId(patientId);
  const digitPatientId = normalizeIdDigits(patientId);
  const exactRow =
    findTextInColumn(patientSheet, ALL_DATA_COLUMNS.uidPrimary, normalizedPatientId, true) ||
    findTextInColumn(patientSheet, ALL_DATA_COLUMNS.uidPrimary, digitPatientId, true);

  if (exactRow) {
    return {
      row: exactRow,
      matchType: "uidPrimaryExact"
    };
  }

  const embeddedRow =
    findTextInColumn(patientSheet, ALL_DATA_COLUMNS.uidSecondary, normalizedPatientId, false) ||
    findTextInColumn(patientSheet, ALL_DATA_COLUMNS.uidSecondary, digitPatientId, false);

  if (embeddedRow) {
    return {
      row: embeddedRow,
      matchType: "uidSecondaryContains"
    };
  }

  return null;
}

function createPatientRowIndex(patientSheet) {
  const lastRow = patientSheet.getLastRow();

  if (lastRow < 2) {
    return [];
  }

  return patientSheet
    .getRange(2, ALL_DATA_COLUMNS.uidPrimary, lastRow - 1, ALL_DATA_COLUMNS.uidSecondary)
    .getDisplayValues()
    .map((row, index) => {
      return {
        rowNumber: index + 2,
        uidPrimary: normalizeId(row[ALL_DATA_COLUMNS.uidPrimary - 1]),
        uidPrimaryDigits: normalizeIdDigits(row[ALL_DATA_COLUMNS.uidPrimary - 1]),
        uidSecondary: normalizeId(row[ALL_DATA_COLUMNS.uidSecondary - 1]),
        uidSecondaryDigits: normalizeIdDigits(row[ALL_DATA_COLUMNS.uidSecondary - 1])
      };
    });
}

function findPatientRowFromIndex(patientRows, patientId) {
  const normalizedPatientId = normalizeId(patientId);
  const digitPatientId = normalizeIdDigits(patientId);

  const exactMatch = patientRows.find((patientRow) => {
    return (
      (normalizedPatientId && patientRow.uidPrimary === normalizedPatientId) ||
      (digitPatientId && patientRow.uidPrimaryDigits === digitPatientId)
    );
  });

  if (exactMatch) {
    return {
      row: exactMatch.rowNumber,
      matchType: "uidPrimaryExact"
    };
  }

  const embeddedMatch = patientRows.find((patientRow) => {
    return (
      (normalizedPatientId && patientRow.uidSecondary.includes(normalizedPatientId)) ||
      (digitPatientId && patientRow.uidSecondaryDigits.includes(digitPatientId))
    );
  });

  if (embeddedMatch) {
    return {
      row: embeddedMatch.rowNumber,
      matchType: "uidSecondaryContains"
    };
  }

  return null;
}

function syncAllDataFollowUp(patientSheet, patientId, selectedDays, createdAt) {
  const match = findPatientRow(patientSheet, patientId);

  if (!match) {
    return {
      matched: false,
      row: null,
      matchType: null
    };
  }

  patientSheet
    .getRange(match.row, ALL_DATA_COLUMNS.patientVisitDate)
    .setNumberFormat("yyyy-mm-dd hh:mm:ss")
    .setValue(createdAt);
  patientSheet.getRange(match.row, ALL_DATA_COLUMNS.visitDay).setValue(asSelectedDays(selectedDays));

  return {
    matched: true,
    row: match.row,
    matchType: match.matchType
  };
}

function getExtensionSubmissions(extensionSheet) {
  const lastRow = extensionSheet.getLastRow();

  if (lastRow < 2) {
    return [];
  }

  const displayRows = extensionSheet.getRange(2, 1, lastRow - 1, 5).getDisplayValues();
  const valueRows = extensionSheet.getRange(2, 1, lastRow - 1, 5).getValues();

  return displayRows
    .map((displayRow, index) => {
      const valueRow = valueRows[index];

      return {
        sourceRow: index + 2,
        patientId: normalizeId(displayRow[EXTENSION_COLUMNS.patientId - 1]),
        patientName: displayRow[EXTENSION_COLUMNS.patientName - 1] || "",
        selectedDays: displayRow[EXTENSION_COLUMNS.selectedDays - 1],
        submissionId: displayRow[EXTENSION_COLUMNS.submissionId - 1] || "",
        createdAt: asDateValue(valueRow[EXTENSION_COLUMNS.createdAt - 1])
      };
    })
    .filter((submission) => submission.patientId);
}

function syncAllRows(extensionSheet, patientSheet) {
  const submissions = getExtensionSubmissions(extensionSheet).sort((left, right) => {
    return left.createdAt.getTime() - right.createdAt.getTime();
  });
  const patientRows = createPatientRowIndex(patientSheet);
  const updatesByPatientRow = {};
  let unmatchedCount = 0;

  submissions.forEach((submission) => {
    const match = findPatientRowFromIndex(patientRows, submission.patientId);

    if (!match) {
      unmatchedCount += 1;
      return;
    }

    updatesByPatientRow[match.row] = {
      ...submission,
      patientRow: match.row,
      matchType: match.matchType
    };
  });

  const updates = Object.values(updatesByPatientRow);

  updates.forEach((update) => {
    patientSheet
      .getRange(update.patientRow, ALL_DATA_COLUMNS.patientVisitDate)
      .setNumberFormat("yyyy-mm-dd hh:mm:ss")
      .setValue(update.createdAt);
    patientSheet
      .getRange(update.patientRow, ALL_DATA_COLUMNS.visitDay)
      .setValue(asSelectedDays(update.selectedDays));
  });

  return {
    ok: true,
    sourceRows: submissions.length,
    matchedRows: updates.length,
    unmatchedRows: unmatchedCount,
    updatedRowsSample: updates.slice(0, 100).map((update) => {
      return {
        sheet1Row: update.sourceRow,
        sheet2Row: update.patientRow,
        patientId: update.patientId,
        matchType: update.matchType
      };
    }),
    omittedUpdatedRows: Math.max(updates.length - 100, 0)
  };
}

function getCleanupTestRows(extensionSheet) {
  const lastRow = extensionSheet.getLastRow();

  if (lastRow < 2) {
    return [];
  }

  const rows = extensionSheet.getRange(2, 1, lastRow - 1, 5).getDisplayValues();
  return rows
    .map((row, index) => {
      return {
        rowNumber: index + 2,
        patientId: normalizeId(row[EXTENSION_COLUMNS.patientId - 1]),
        patientName: normalizeId(row[EXTENSION_COLUMNS.patientName - 1]),
        selectedDays: normalizeId(row[EXTENSION_COLUMNS.selectedDays - 1]),
        submissionId: normalizeId(row[EXTENSION_COLUMNS.submissionId - 1]),
        createdAt: normalizeId(row[EXTENSION_COLUMNS.createdAt - 1])
      };
    })
    .filter((row) => {
      const isBlankWrite =
        !row.patientId &&
        !row.patientName &&
        !row.selectedDays &&
        !row.submissionId &&
        Boolean(row.createdAt);
      const isCodexTest =
        row.patientId.indexOf("CODEX_TEST") === 0 || row.submissionId.indexOf("codex-test") === 0;

      return isBlankWrite || isCodexTest;
    })
    .map((row) => row.rowNumber);
}

function cleanupTestRowsPreview(extensionSheet) {
  return {
    ok: true,
    rowsToDelete: getCleanupTestRows(extensionSheet)
  };
}

function cleanupTestRows(extensionSheet) {
  const rowsToDelete = getCleanupTestRows(extensionSheet).sort((left, right) => right - left);

  rowsToDelete.forEach((rowNumber) => {
    extensionSheet.deleteRow(rowNumber);
  });

  return {
    ok: true,
    deletedRows: rowsToDelete.sort((left, right) => left - right)
  };
}

function buildTomorrowFollowUps(patientSheet, outputSheet) {
  const lastRow = patientSheet.getLastRow();
  const tomorrowKey = dateKey(getTomorrowDate());
  const outputHeaders = [
    "UID",
    "ID",
    "UID",
    "Adhar Number",
    "Patient Name",
    "Mobile Number",
    "Age",
    "Address",
    "Patient visit Date",
    "Day",
    "Follow up Date",
    "Follow Up Day",
    "Calling Patient"
  ];

  const outputRows = [outputHeaders];

  if (lastRow >= 2) {
    const displayRows = patientSheet.getRange(2, 1, lastRow - 1, ALL_DATA_COLUMNS.callingPatient).getDisplayValues();
    const valueRows = patientSheet.getRange(2, 1, lastRow - 1, ALL_DATA_COLUMNS.callingPatient).getValues();

    valueRows.forEach((valueRow, index) => {
      const displayRow = displayRows[index];
      const visitDate = asExistingDate(valueRow[ALL_DATA_COLUMNS.patientVisitDate - 1]);
      const selectedDays = valueRow[ALL_DATA_COLUMNS.visitDay - 1];
      const followUpDate = getAdjustedFollowUpDate(visitDate, selectedDays);

      if (!followUpDate || dateKey(followUpDate) !== tomorrowKey) {
        return;
      }

      outputRows.push([
        displayRow[ALL_DATA_COLUMNS.uidPrimary - 1],
        displayRow[ALL_DATA_COLUMNS.id - 1],
        displayRow[ALL_DATA_COLUMNS.uidSecondary - 1],
        displayRow[ALL_DATA_COLUMNS.adharNumber - 1],
        displayRow[ALL_DATA_COLUMNS.patientName - 1],
        displayRow[ALL_DATA_COLUMNS.mobileNumber - 1],
        displayRow[ALL_DATA_COLUMNS.age - 1],
        displayRow[ALL_DATA_COLUMNS.address - 1],
        visitDate,
        asSelectedDays(selectedDays),
        displayRow[ALL_DATA_COLUMNS.followUpDate - 1],
        displayRow[ALL_DATA_COLUMNS.followUpDay - 1],
        displayRow[ALL_DATA_COLUMNS.callingPatient - 1]
      ]);
    });
  }

  outputSheet.clearContents();
  outputSheet.clearFormats();
  outputSheet.getRange(1, 1, outputRows.length, outputHeaders.length).setValues(outputRows);
  outputSheet.getRange(1, 1, 1, outputHeaders.length).setFontWeight("bold");
  outputSheet.setFrozenRows(1);

  if (outputRows.length > 1) {
    outputSheet
      .getRange(2, ALL_DATA_COLUMNS.patientVisitDate, outputRows.length - 1, 1)
      .setNumberFormat("yyyy-mm-dd hh:mm:ss");
  }

  outputSheet.autoResizeColumns(1, outputHeaders.length);

  return {
    ok: true,
    targetDate: tomorrowKey,
    sheetName: outputSheet.getName(),
    rowCount: outputRows.length - 1
  };
}

function emailTomorrowFollowUps(outputSheet, buildResult) {
  const recipients = normalizeId(FOLLOWUP_EMAIL_RECIPIENTS);

  if (!recipients) {
    return {
      ok: true,
      skipped: true,
      reason: "FOLLOWUP_EMAIL_RECIPIENTS is blank."
    };
  }

  const lastRow = Math.max(outputSheet.getLastRow(), 1);
  const lastColumn = Math.max(outputSheet.getLastColumn(), 1);
  const rows = outputSheet.getRange(1, 1, lastRow, lastColumn).getValues();
  const csv = rowsToCsv(rows);
  const fileName = "tomorrow-follow-ups-" + buildResult.targetDate + ".csv";

  MailApp.sendEmail({
    to: recipients,
    subject: "Tomorrow Follow-ups - " + buildResult.targetDate,
    body:
      "Attached is the Tomorrow Follow-ups export for " +
      buildResult.targetDate +
      ". Rows: " +
      buildResult.rowCount,
    attachments: [Utilities.newBlob(csv, "text/csv", fileName)]
  });

  return {
    ok: true,
    skipped: false,
    recipients,
    fileName
  };
}

function refreshTomorrowFollowUps(sendEmail) {
  const sheets = openConfiguredSheets();
  const syncResult = syncAllRows(sheets.extensionSheet, sheets.patientSheet);
  const outputSheet =
    sheets.spreadsheet.getSheetByName(TOMORROW_FOLLOWUPS_SHEET_NAME) ||
    sheets.spreadsheet.insertSheet(TOMORROW_FOLLOWUPS_SHEET_NAME);
  const buildResult = buildTomorrowFollowUps(sheets.patientSheet, outputSheet);
  const emailResult = sendEmail ? emailTomorrowFollowUps(outputSheet, buildResult) : null;

  return {
    ok: true,
    syncResult: {
      sourceRows: syncResult.sourceRows,
      matchedRows: syncResult.matchedRows,
      unmatchedRows: syncResult.unmatchedRows
    },
    followUps: buildResult,
    email: emailResult
  };
}

function exportTomorrowFollowUpsCsv() {
  const sheets = openConfiguredSheets();
  const outputSheet = sheets.spreadsheet.getSheetByName(TOMORROW_FOLLOWUPS_SHEET_NAME);

  if (!outputSheet) {
    refreshTomorrowFollowUps(false);
  }

  const refreshedOutputSheet = sheets.spreadsheet.getSheetByName(TOMORROW_FOLLOWUPS_SHEET_NAME);
  const lastRow = Math.max(refreshedOutputSheet.getLastRow(), 1);
  const lastColumn = Math.max(refreshedOutputSheet.getLastColumn(), 1);
  const rows = refreshedOutputSheet.getRange(1, 1, lastRow, lastColumn).getValues();

  return rowsToCsv(rows);
}

function openConfiguredSheets() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const extensionSheet = spreadsheet.getSheetByName(EXTENSION_SHEET_NAME);
  const patientSheet = spreadsheet.getSheetByName(PATIENT_SHEET_NAME);

  if (!extensionSheet) {
    throw new Error("Sheet not found: " + EXTENSION_SHEET_NAME);
  }

  if (!patientSheet) {
    throw new Error("Sheet not found: " + PATIENT_SHEET_NAME);
  }

  return {
    spreadsheet,
    extensionSheet,
    patientSheet
  };
}

function scheduledSyncAllRows() {
  const lock = LockService.getScriptLock();
  let locked = false;

  try {
    lock.waitLock(5000);
    locked = true;

    const sheets = openConfiguredSheets();
    return syncAllRows(sheets.extensionSheet, sheets.patientSheet);
  } finally {
    if (locked) {
      lock.releaseLock();
    }
  }
}

function scheduledRefreshTomorrowFollowUps() {
  const lock = LockService.getScriptLock();
  let locked = false;

  try {
    lock.waitLock(5000);
    locked = true;

    return refreshTomorrowFollowUps(true);
  } finally {
    if (locked) {
      lock.releaseLock();
    }
  }
}

function installThirtyMinuteSyncTrigger() {
  removeThirtyMinuteSyncTrigger();

  ScriptApp.newTrigger(SCHEDULED_SYNC_FUNCTION_NAME).timeBased().everyMinutes(30).create();

  return {
    ok: true,
    installedFunction: SCHEDULED_SYNC_FUNCTION_NAME,
    intervalMinutes: 30
  };
}

function removeThirtyMinuteSyncTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  let removedCount = 0;

  triggers.forEach((trigger) => {
    if (trigger.getHandlerFunction() !== SCHEDULED_SYNC_FUNCTION_NAME) {
      return;
    }

    ScriptApp.deleteTrigger(trigger);
    removedCount += 1;
  });

  return {
    ok: true,
    removedCount
  };
}

function installThreeHourTomorrowFollowUpsTrigger() {
  removeThreeHourTomorrowFollowUpsTrigger();

  ScriptApp.newTrigger(SCHEDULED_TOMORROW_FOLLOWUPS_FUNCTION_NAME).timeBased().everyHours(3).create();

  return {
    ok: true,
    installedFunction: SCHEDULED_TOMORROW_FOLLOWUPS_FUNCTION_NAME,
    intervalHours: 3
  };
}

function removeThreeHourTomorrowFollowUpsTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  let removedCount = 0;

  triggers.forEach((trigger) => {
    if (trigger.getHandlerFunction() !== SCHEDULED_TOMORROW_FOLLOWUPS_FUNCTION_NAME) {
      return;
    }

    ScriptApp.deleteTrigger(trigger);
    removedCount += 1;
  });

  return {
    ok: true,
    removedCount
  };
}

function diagnose() {
  const sheets = openConfiguredSheets();
  const extensionLastRow = sheets.extensionSheet.getLastRow();
  const patientLastRow = sheets.patientSheet.getLastRow();

  return {
    ok: true,
    spreadsheetId: SPREADSHEET_ID,
    sheetNames: sheets.spreadsheet.getSheets().map((sheet) => sheet.getName()),
    extensionSheetName: sheets.extensionSheet.getName(),
    allDataSheetName: sheets.patientSheet.getName(),
    extensionSheetLastRow: extensionLastRow,
    patientSheetLastRow: patientLastRow,
    extensionHeaders:
      extensionLastRow >= 1 ? sheets.extensionSheet.getRange(1, 1, 1, 5).getDisplayValues()[0] : [],
    patientHeaders:
      patientLastRow >= 1 ? sheets.patientSheet.getRange(1, 1, 1, 12).getDisplayValues()[0] : [],
    scheduledSyncFunctionName: SCHEDULED_SYNC_FUNCTION_NAME,
    scheduledTomorrowFollowUpsFunctionName: SCHEDULED_TOMORROW_FOLLOWUPS_FUNCTION_NAME,
    tomorrowFollowUpsSheetName: TOMORROW_FOLLOWUPS_SHEET_NAME,
    emailConfigured: Boolean(normalizeId(FOLLOWUP_EMAIL_RECIPIENTS))
  };
}

function doGet(e) {
  const lock = LockService.getScriptLock();
  let locked = false;
  const parameters = e && e.parameter ? e.parameter : {};

  try {
    if (parameters.action === "ping") {
      return jsonResponse({
        ok: true,
        action: "ping",
        timestamp: new Date().toISOString()
      });
    }

    if (parameters.action === "diagnose") {
      return jsonResponse(diagnose());
    }

    lock.waitLock(5000);
    locked = true;

    const sheets = openConfiguredSheets();
    const extensionSheet = sheets.extensionSheet;
    const patientSheet = sheets.patientSheet;

    if (parameters.action === "syncAllRows") {
      return jsonResponse(syncAllRows(extensionSheet, patientSheet));
    }

    if (parameters.action === "refreshTomorrowFollowUps") {
      return jsonResponse(refreshTomorrowFollowUps(false));
    }

    if (parameters.action === "emailTomorrowFollowUps") {
      return jsonResponse(refreshTomorrowFollowUps(true));
    }

    if (parameters.action === "exportTomorrowFollowUpsCsv") {
      return csvResponse(exportTomorrowFollowUpsCsv());
    }

    if (parameters.action === "cleanupTestRows") {
      return jsonResponse(cleanupTestRows(extensionSheet));
    }

    if (parameters.action === "cleanupTestRowsPreview") {
      return jsonResponse(cleanupTestRowsPreview(extensionSheet));
    }

    if (parameters.action === "installThirtyMinuteSyncTrigger") {
      return jsonResponse(installThirtyMinuteSyncTrigger());
    }

    if (parameters.action === "removeThirtyMinuteSyncTrigger") {
      return jsonResponse(removeThirtyMinuteSyncTrigger());
    }

    if (parameters.action === "installThreeHourTomorrowFollowUpsTrigger") {
      return jsonResponse(installThreeHourTomorrowFollowUpsTrigger());
    }

    if (parameters.action === "removeThreeHourTomorrowFollowUpsTrigger") {
      return jsonResponse(removeThreeHourTomorrowFollowUpsTrigger());
    }

    const patientId = normalizeId(parameters.patientId);
    const patientName = parameters.patientName || "";
    const selectedDays = parameters.selectedDays || "";
    const submissionId = normalizeId(parameters.submissionId);

    if (isDuplicateSubmission(extensionSheet, submissionId)) {
      return jsonResponse({
        ok: true,
        duplicate: true,
        submissionId
      });
    }

    const createdAt = new Date();

    const extensionWriteRow = extensionSheet.getLastRow() + 1;
    extensionSheet
      .getRange(extensionWriteRow, EXTENSION_COLUMNS.patientId, 1, 1)
      .setNumberFormat("@");
    extensionSheet
      .getRange(extensionWriteRow, EXTENSION_COLUMNS.submissionId, 1, 1)
      .setNumberFormat("@");
    extensionSheet
      .getRange(extensionWriteRow, EXTENSION_COLUMNS.createdAt, 1, 1)
      .setNumberFormat("yyyy-mm-dd hh:mm:ss");
    extensionSheet.getRange(extensionWriteRow, 1, 1, 5).setValues([
      [patientId, patientName, asSelectedDays(selectedDays), submissionId, createdAt]
    ]);

    const allDataSync = syncAllDataFollowUp(patientSheet, patientId, selectedDays, createdAt);

    return jsonResponse({
      ok: true,
      patientId,
      normalizedPatientId: normalizeIdDigits(patientId),
      patientName,
      selectedDays,
      submissionId,
      createdAt: createdAt.toISOString(),
      extensionWriteRow,
      allDataSheetName: patientSheet.getName(),
      allDataSync
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
