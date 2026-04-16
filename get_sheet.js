const { google } = require("googleapis");
const path = require("path");

// ===== Google Form Data =====
const SERVICE_ACCOUNT_FILE = path.join(__dirname, "service-account.json");
const SPREADSHEET_ID = "1iCszLbkhZOpQfV4fubIHXIp8q6ajWhE31PzgeZvFA3g";
const SHEET_NAME = "Form Responses 1";
const RANGE = `${SHEET_NAME}!A:Z`;

// ===== Master Data =====
const MASTER_SPREADSHEET_ID = "1LRg_0DeuHgIwax7FV0pCYYr9NyPb9ToGxXGcS0TTDPY";
const MASTER_SHEET_NAME = "Sheet1";
const MASTER_RANGE = `${MASTER_SHEET_NAME}!A:H`;

// ===== MAIN SHEET COLUMN MAP =====
// ปรับตามชีตจริงของคุณ
const MAIN_COL = {
  A: "Timestamp",
  B: "Vehicle Type",
  C: "Section/Department",
  D: "Vehicle Registration Number",
  E: "Full Name Thai",
  F: "Parking Card ID",
  G: "Email",
  H: "Status",
  I: "Error Message",
};

// ===== MASTER SHEET COLUMN MAP =====
// A = Suffix (Thai)
// B = Name-Surname (Thai)
// C = Name Surname
// D = Company
// E = Department
// F = Section
// G = Vehicle Registration
// H = Vehicle Type

function clean(value) {
  return (value || "").toString().trim();
}
/*
function cleanNoSpace(value) {
  return clean(value).replace(/\s+/g, "");
}
*/

function cleanNoSpace(value) {
  return (value || "")
    .toString()
    .normalize("NFC")
    .replace(/[\u200B-\u200D\uFEFF\u00A0]/g, "")
    .replace(/\s+/g, "")
    .trim();
}

function formatTodayMMDDYYYY() {
  const now = new Date();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const year = now.getFullYear();
  return `${month}/${day}/${year}`;
}

async function getGoogleClients() {
  const auth = new google.auth.GoogleAuth({
    keyFile: SERVICE_ACCOUNT_FILE,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const client = await auth.getClient();
  const sheets = google.sheets({ version: "v4", auth: client });

  return { sheets };
}

function columnToLetter(columnNumber) {
  let temp = "";
  let letter = "";

  while (columnNumber > 0) {
    temp = (columnNumber - 1) % 26;
    letter = String.fromCharCode(temp + 65) + letter;
    columnNumber = Math.floor((columnNumber - temp - 1) / 26);
  }

  return letter;
}

function mapRowWithColumnLetters(row, totalColumns = 26) {
  const obj = {};

  for (let i = 0; i < totalColumns; i++) {
    const colLetter = columnToLetter(i + 1);
    obj[colLetter] = row[i] || "";
  }

  return obj;
}

async function getSheetDataTodayOnly() {
  const { sheets } = await getGoogleClients();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: RANGE,
  });

  const rows = res.data.values || [];
  if (rows.length <= 1) return [];

  const todayText = formatTodayMMDDYYYY();

  const data = rows.slice(1).map((row, index) => {
    const obj = mapRowWithColumnLetters(row, 26);
    obj.__rowNumber = index + 2;
    return obj;
  });

  return data.filter((item) => {
    const rawDate = clean(item.A); // Timestamp
    const status = clean(item.H);  // Status (No input required)

    if (!rawDate) return false;

    // รองรับทั้ง "3/24/2026, 16:59:34" และ "3/24/2026 16:59:34"
    const datePart = rawDate.includes(",")
      ? rawDate.split(",")[0].trim()
      : rawDate.split(" ")[0].trim();

    const isToday = datePart === todayText;
    const isStatusEmpty = status === "";

    return isToday && isStatusEmpty;
  });
}

async function updateCellByColumn(rowNumber, columnLetter, value) {
  const { sheets } = await getGoogleClients();

  const updateRange = `${SHEET_NAME}!${columnLetter}${rowNumber}`;

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: updateRange,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[value]],
    },
  });
}

async function updateRowResult(rowNumber, statusText, errorMessage = "") {
  // H = Status
  // I = Error Message
  await updateCellByColumn(rowNumber, "H", statusText);
  await updateCellByColumn(rowNumber, "I", errorMessage);
}

async function getMasterData() {
  const { sheets } = await getGoogleClients();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: MASTER_SPREADSHEET_ID,
    range: MASTER_RANGE,
  });

  const rows = res.data.values || [];
  if (rows.length <= 1) return [];

  return rows.slice(1).map((row, index) => {
    const obj = mapRowWithColumnLetters(row, 8);
    obj.__rowNumber = index + 2;
    return obj;
  });
}

function checkOwnerMatch(masterRows, fullName, vehicleReg) {
  const targetName = cleanNoSpace(fullName);
  const targetVehicleReg = clean(vehicleReg);

  const matchedOwnerRows = masterRows.filter((row) => {
    const thaiName = cleanNoSpace(row.B); // Name-Surname (Thai)
    const engName = cleanNoSpace(row.C);  // Name Surname

    const nameMatched =
      targetName !== "" &&
      (targetName === thaiName || targetName === engName);

    return nameMatched;
  });

  if (matchedOwnerRows.length === 0) {
    return {
      success: false,
      reason: "Owner not match",
    };
  }

  const vehicleMatched = matchedOwnerRows.some((row) => {
    return clean(row.G) === targetVehicleReg; // Vehicle Registration
  });

  if (!vehicleMatched) {
    return {
      success: false,
      reason: "Owner not match",
    };
  }

  return {
    success: true,
    reason: "",
  };
}

function isVehicleRegMatch(value1, value2) {
  return cleanNoSpace(value1) === cleanNoSpace(value2);
}

module.exports = {
  clean,
  cleanNoSpace,
  getSheetDataTodayOnly,
  updateCellByColumn,
  updateRowResult,
  getMasterData,
  checkOwnerMatch,
  isVehicleRegMatch,
  MAIN_COL,
};