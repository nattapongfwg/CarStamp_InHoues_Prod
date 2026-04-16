const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const {
  getSheetDataTodayOnly,
  updateRowResult,
  getMasterData,
  checkOwnerMatch,
  isVehicleRegMatch,
} = require("./get_sheet");

function clean(value) {
  return (value || "").toString().trim();
}

const LOGIN_URL = "https://estamp-carpark.lpn.co.th/JudjodEStamp_LPN/";
const LOGIN_USERNAME = "adminfws";
const LOGIN_PASSWORD = "admfws";

function getCurrentDateTime() {
  const now = new Date();

  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yyyy = now.getFullYear();

  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");

  return `${dd}/${mm}/${yyyy} ${hh}:${mi}:${ss}`;
}

function getCurrentDateForFile() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function ensureLogFolder() {
  const logDir = path.join(__dirname, "logs");
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  return logDir;
}

function getLogFilePath() {
  const logDir = ensureLogFolder();
  return path.join(logDir, `app-${getCurrentDateForFile()}.log`);
}

function writeLogLine(line) {
  const logFile = getLogFilePath();
  fs.appendFileSync(logFile, `${line}\n`, "utf8");
}

function logInfo(message) {
  const line = `[${getCurrentDateTime()}] INFO: ${message}`;
  console.log(line);
  writeLogLine(line);
}

function logError(message) {
  const line = `[${getCurrentDateTime()}] ERROR: ${message}`;
  console.error(line);
  writeLogLine(line);
}

function logData(obj) {
  const line = `[${getCurrentDateTime()}] DATA: ${JSON.stringify(obj)}`;
  console.log(JSON.stringify(obj, null, 2));
  writeLogLine(line);
}

async function loginWebsite() {
  const browser = await chromium.launch({
    headless: false, // เปลี่ยนเป็น false ถ้าอยากเห็น browser
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(LOGIN_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    await page.fill("#Username", LOGIN_USERNAME);
    await page.fill("#Password", LOGIN_PASSWORD);
    await page.click('button[type="submit"]');

    await page
      .waitForURL((url) => url.toString().includes("/Home/Index"), {
        timeout: 30000,
      })
      .catch(() => null);

    await page.waitForTimeout(2000);

    const loginError = await page
      .locator("#LoginError")
      .textContent()
      .catch(() => "");
    const errorValidate = await page
      .locator(".Error-validate")
      .textContent()
      .catch(() => "");

    const stillOnLogin =
      (await page
        .locator("#Username")
        .count()
        .catch(() => 0)) > 0 &&
      (await page
        .locator("#Password")
        .count()
        .catch(() => 0)) > 0;

    const hasVisibleError =
      (loginError && loginError.trim() !== "") ||
      (errorValidate && errorValidate.trim() !== "");

    if (stillOnLogin && hasVisibleError) {
      return {
        success: false,
        browser,
        page,
        message: "Login failed",
        currentUrl: page.url(),
        loginError: (loginError || "").trim(),
        errorValidate: (errorValidate || "").trim(),
      };
    }

    return {
      success: true,
      browser,
      page,
      message: "Login successful",
      currentUrl: page.url(),
    };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

async function searchOpenStampConfirm(
  page,
  cardSerial,
  fullName,
  expectedVehicleReg,
) {
  await page.waitForSelector("#card-search", { timeout: 30000 });

  await page.evaluate(() => {
    const hidden = document.querySelector("#searchType");
    if (hidden) hidden.value = "card";
  });

  await page.fill("#card-search", "");
  await page.fill("#card-search", String(cardSerial));

  await page
    .locator('button[onclick="btnSearchCard()"]')
    .click({ force: true });
  await page.waitForTimeout(3000);

  const openButton = page
    .locator("#mySidenav button.btn.btn-success.btn-lg", { hasText: "OPEN" })
    .first();

  let openClicked = false;
  let stampSelected = false;
  let remarkFilled = false;
  let confirmClicked = false;
  let popupConfirmClicked = false;
  let targetStampValue = "";
  let websiteLicense = "";
  let vehicleMatched = false;

  if (await openButton.isVisible().catch(() => false)) {
    await openButton.click({ force: true });
    openClicked = true;
    await page.waitForTimeout(2000);
  }

  // ===== NEW STEP: CHECK LICENSE FROM WEBSITE =====
  if (openClicked) {
    await page
      .waitForSelector("#licenseSelect", { timeout: 10000 })
      .catch(() => null);
/*
    websiteLicense = await page
      .locator("#licenseSelect")
      .textContent()
      .catch(() => "");
*/
    websiteLicense = 'aaa';
    websiteLicense = clean(websiteLicense);

    vehicleMatched = isVehicleRegMatch(websiteLicense, expectedVehicleReg);

    if (!vehicleMatched) {
      return {
        success: false,
        step: "Verified Vehical No. in Website",
        failReason: "Vehical No. not match in master",
        openClicked,
        stampSelected,
        remarkFilled,
        confirmClicked,
        popupConfirmClicked,
        selectedStampValue: null,
        remarkValue: null,
        websiteLicense,
        expectedVehicleReg,
        vehicleMatched,
        currentUrl: page.url(),
      };
    }
  }

  if (openClicked && vehicleMatched) {
    await page.waitForSelector("#slStampCode", { timeout: 10000 });

    const firstChar = clean(cardSerial).charAt(0).toUpperCase();

    if (firstChar === "M") {
      targetStampValue = "2024";
    } else if (firstChar === "C") {
      targetStampValue = "260";
    }

    if (targetStampValue) {
      await page.selectOption("#slStampCode", targetStampValue);
      await page.waitForTimeout(1000);

      const selectedValue = await page
        .locator("#slStampCode")
        .inputValue()
        .catch(() => "");

      stampSelected = selectedValue === targetStampValue;
    }

    await page.fill("#remake-search", "");
    await page.fill("#remake-search", String(fullName || ""));
    remarkFilled = true;

    await page.waitForTimeout(500);

    await page.locator("#imgBtnConfirm").click({ force: true });
    confirmClicked = true;

    const popupConfirmButton = page
      .locator('.modal-content button.std-btn-yellow[onclick="setData()"]')
      .first();

    await popupConfirmButton
      .waitFor({
        state: "visible",
        timeout: 10000,
      })
      .catch(() => null);

    if (await popupConfirmButton.isVisible().catch(() => false)) {
      await popupConfirmButton.click({ force: true });
      popupConfirmClicked = true;
      await page.waitForTimeout(3000);
    }
  }

  return {
    success:
      openClicked &&
      vehicleMatched &&
      stampSelected &&
      remarkFilled &&
      confirmClicked &&
      popupConfirmClicked,
    openClicked,
    vehicleMatched,
    websiteLicense,
    expectedVehicleReg,
    stampSelected,
    remarkFilled,
    confirmClicked,
    popupConfirmClicked,
    selectedStampValue: stampSelected ? targetStampValue : null,
    remarkValue: remarkFilled ? String(fullName || "") : null,
    currentUrl: page.url(),
  };
}


function getFailReason(result) {
  if (!result.openClicked)
    return "OPEN button not visible or not clicked (Not Found Parking Card ID)";
  if (result.vehicleMatched === false) return "Vehical No. not match in master";
  if (!result.stampSelected) return "Stamp code 260 not selected";
  if (!result.remarkFilled) return "Remark not filled";
  if (!result.confirmClicked) return "Confirm button not clicked";
  if (!result.popupConfirmClicked) return "Popup confirm button not clicked";
  return "Automation failed before final confirm";
}

async function safeUpdateRowResult(rowNumber, statusText, errorMessage = "") {
  try {
    await updateRowResult(rowNumber, statusText, errorMessage);
  } catch (e) {
    logError(`Update sheet failed at row ${rowNumber}: ${e.message}`);
  }
}

async function main() {
  try {
    const rows = await getSheetDataTodayOnly();
    const masterRows = await getMasterData();

    if (!rows.length) {
      logInfo("No rows found for today");
      return;
    }

    logInfo(`Found ${rows.length} today row(s)`);

    for (const row of rows) {
      const fullName = clean(row.E);
      const cardSerial = clean(row.F);
      const vehicleReg = clean(row.D);
      const rowNumber = row.__rowNumber;

      const processDate = getCurrentDateTime();

      logInfo("========================================");
      logInfo(
        `Processing: ${fullName} | Card Serial: ${cardSerial} | Vehicle: ${vehicleReg} | Row: ${rowNumber} | ProcessDate: ${processDate}`,
      );

      // ===== STEP 0: CHECK OWNER MATCH AGAINST MASTER =====
      const ownerCheck = checkOwnerMatch(masterRows, fullName, vehicleReg);

      if (!ownerCheck.success) {
        await safeUpdateRowResult(rowNumber, "Owner not match", "");
        logData({
          success: false,
          step: "owner-check",
          fullName,
          cardSerial,
          vehicleReg,
          error: ownerCheck.reason,
        });
        continue;
      }

      if (!cardSerial) {
        await safeUpdateRowResult(
          rowNumber,
          "automate failed",
          "Card Serial is empty",
        );
        logData({
          success: false,
          fullName,
          cardSerial,
          error: "Card Serial is empty",
        });
        continue;
      }

      let session;

      try {
        session = await loginWebsite();

        if (!session.success) {
          const errorMessage =
            session.loginError ||
            session.errorValidate ||
            session.message ||
            "Login failed";

          await safeUpdateRowResult(rowNumber, "automate failed", errorMessage);

          logData({
            success: false,
            step: "login",
            fullName,
            cardSerial,
            error: errorMessage,
          });

          continue;
        }

        const result = await searchOpenStampConfirm(
          session.page,
          cardSerial,
          fullName,
          vehicleReg,
        );

        if (result.success) {
          await safeUpdateRowResult(rowNumber, "Success", "");
        } else {
          const failReason = getFailReason(result);
          await safeUpdateRowResult(rowNumber, "automate failed", failReason);
        }

        logData({
          success: result.success,
          step: "search-open-stamp-confirm-popup",
          fullName,
          cardSerial,
          vehicleReg,
          currentUrl: result.currentUrl,
          openClicked: result.openClicked,
          stampSelected: result.stampSelected,
          selectedStampValue: result.selectedStampValue,
          remarkFilled: result.remarkFilled,
          remarkValue: result.remarkValue,
          confirmClicked: result.confirmClicked,
          popupConfirmClicked: result.popupConfirmClicked,
        });
      } catch (error) {
        await safeUpdateRowResult(
          rowNumber,
          "automate failed",
          error.message || "Unknown error",
        );

        logData({
          success: false,
          fullName,
          cardSerial,
          vehicleReg,
          error: error.message,
        });
      } finally {
        if (session?.browser) {
          await session.browser.close();
        }
      }
    }
  } catch (error) {
    logError(`Error in index.js: ${error.message}`);
  }
}

main();
