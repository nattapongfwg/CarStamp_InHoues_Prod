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
const HOME_URL = `${LOGIN_URL}Home/Index`;
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

async function createBrowserSession() {
  const browser = await chromium.launch({
    headless: true, // true not show website
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(20000);

  return { browser, context, page };
}

async function doLogin(page) {
  await page.goto(LOGIN_URL, {
    waitUntil: "domcontentloaded",
    timeout: 20000,
  });

  await page.fill("#Username", LOGIN_USERNAME);
  await page.fill("#Password", LOGIN_PASSWORD);
  await page.click('button[type="submit"]');

  await page.waitForLoadState("domcontentloaded").catch(() => null);

  // Try a few signals for successful login
  const readyBySearchBox = await page
    .locator("#card-search")
    .waitFor({ state: "visible", timeout: 10000 })
    .then(() => true)
    .catch(() => false);

  if (readyBySearchBox) {
    return {
      success: true,
      message: "Login successful",
      currentUrl: page.url(),
    };
  }

  const loginError = await page.locator("#LoginError").textContent().catch(() => "");
  const errorValidate = await page.locator(".Error-validate").textContent().catch(() => "");

  const stillOnLogin =
    (await page.locator("#Username").isVisible().catch(() => false)) &&
    (await page.locator("#Password").isVisible().catch(() => false));

  if (stillOnLogin) {
    return {
      success: false,
      message: "Login failed",
      currentUrl: page.url(),
      loginError: clean(loginError),
      errorValidate: clean(errorValidate),
    };
  }

  // Sometimes site is slow: try direct Home page once before failing
  await page.goto(HOME_URL, {
    waitUntil: "domcontentloaded",
    timeout: 15000,
  }).catch(() => null);

  const readyAfterGoto = await page
    .locator("#card-search")
    .waitFor({ state: "visible", timeout: 8000 })
    .then(() => true)
    .catch(() => false);

  if (readyAfterGoto) {
    return {
      success: true,
      message: "Login successful",
      currentUrl: page.url(),
    };
  }

  return {
    success: false,
    message: "Login failed or search page not ready",
    currentUrl: page.url(),
    loginError: clean(loginError),
    errorValidate: clean(errorValidate),
  };
}

async function loginWebsite() {
  const session = await createBrowserSession();

  try {
    const loginResult = await doLogin(session.page);

    if (!loginResult.success) {
      await session.browser.close();
      return {
        success: false,
        message: loginResult.message,
        loginError: loginResult.loginError,
        errorValidate: loginResult.errorValidate,
        currentUrl: loginResult.currentUrl,
      };
    }

    return {
      success: true,
      browser: session.browser,
      context: session.context,
      page: session.page,
      message: "Login successful",
      currentUrl: loginResult.currentUrl,
    };
  } catch (error) {
    await session.browser.close();
    return {
      success: false,
      message: error.message || "Login failed",
    };
  }
}

async function ensureLoggedIn(session) {
  try {
    const navState = await backToSearchPage(session.page);

    if (navState.ok) {
      if (navState.reason !== "Search page already ready") {
        logInfo(`Recovered current session: ${navState.reason}`);
      }
      return session;
    }

    if (!navState.needRelogin) {
      throw new Error(navState.reason || "Cannot recover current session");
    }

    logInfo("Session really expired, re-login required");

    if (session?.browser) {
      await session.browser.close().catch(() => null);
    }

    const newSession = await loginWebsite();

    if (!newSession.success) {
      throw new Error(
        newSession.loginError ||
          newSession.errorValidate ||
          newSession.message ||
          "Re-login failed"
      );
    }

    return newSession;
  } catch (error) {
    throw new Error(`ensureLoggedIn failed: ${error.message}`);
  }
}

async function backToSearchPage(page) {
  const hasSearchBoxNow = await page
    .locator("#card-search")
    .isVisible()
    .catch(() => false);

  if (hasSearchBoxNow) {
    return {
      ok: true,
      needRelogin: false,
      reason: "Search page already ready",
    };
  }

  await page.goto(HOME_URL, {
    waitUntil: "domcontentloaded",
    timeout: 15000,
  }).catch(() => null);

  const hasSearchBoxAfterGoto = await page
    .locator("#card-search")
    .isVisible()
    .catch(() => false);

  if (hasSearchBoxAfterGoto) {
    return {
      ok: true,
      needRelogin: false,
      reason: "Recovered by going back to Home/Index",
    };
  }

  const hasLoginForm =
    (await page.locator("#Username").isVisible().catch(() => false)) &&
    (await page.locator("#Password").isVisible().catch(() => false));

  if (hasLoginForm) {
    return {
      ok: false,
      needRelogin: true,
      reason: "Redirected to login page",
    };
  }

  return {
    ok: false,
    needRelogin: false,
    reason: "Cannot recover search page",
  };
}

async function searchOpenStampConfirm(page, cardSerial, fullName, expectedVehicleReg) {
  const navState = await backToSearchPage(page);

  if (!navState.ok) {
    if (navState.needRelogin) {
      throw new Error("Session expired");
    }
    throw new Error(navState.reason || "Cannot return to search page");
  }

  await page.evaluate(() => {
    const hidden = document.querySelector("#searchType");
    if (hidden) hidden.value = "card";
  });

  await page.fill("#card-search", "");
  await page.fill("#card-search", String(cardSerial));

  await page.locator('button[onclick="btnSearchCard()"]').click({ force: true });

  const openButton = page
    .locator("#mySidenav button.btn.btn-success.btn-lg", { hasText: "OPEN" })
    .first();

  await openButton.waitFor({ state: "visible", timeout: 8000 }).catch(() => null);

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
  }

  if (openClicked) {
    await page.waitForSelector("#licenseSelect", { timeout: 8000 }).catch(() => null);

    websiteLicense = await page.locator("#licenseSelect").textContent().catch(() => "");
    websiteLicense = clean(websiteLicense);

    vehicleMatched = isVehicleRegMatch(websiteLicense, expectedVehicleReg);

    if (!vehicleMatched) {
      return {
        success: false,
        step: "Vehicle-check to Master",
        failReason: "Vehicle No. not match in master",
        openClicked,
        vehicleMatched,
        websiteLicense,
        expectedVehicleReg,
        stampSelected,
        remarkFilled,
        confirmClicked,
        popupConfirmClicked,
        selectedStampValue: null,
        remarkValue: null,
        currentUrl: page.url(),
      };
    }
  }

  if (openClicked && vehicleMatched) {
    await page.waitForSelector("#slStampCode", { timeout: 4000 });

    const firstChar = clean(cardSerial).charAt(0).toUpperCase();

    if (firstChar === "M") {
      targetStampValue = "2024";
    } else if (firstChar === "C") {
      targetStampValue = "260";
    }

    if (targetStampValue) {
      await page.selectOption("#slStampCode", targetStampValue);

      const selectedValue = await page.locator("#slStampCode").inputValue().catch(() => "");
      stampSelected = selectedValue === targetStampValue;
    }

    await page.fill("#remake-search", "");
    await page.fill("#remake-search", String(fullName || ""));
    remarkFilled = true;

    await page.locator("#imgBtnConfirm").click({ force: true });
    confirmClicked = true;

    const popupConfirmButton = page
      .locator('.modal-content button.std-btn-yellow[onclick="setData()"]')
      .first();

    await popupConfirmButton.waitFor({
      state: "visible",
      timeout: 4000,
    }).catch(() => null);

    if (await popupConfirmButton.isVisible().catch(() => false)) {
      await popupConfirmButton.click({ force: true });
      popupConfirmClicked = true;
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
  if (!result.openClicked) {
    return "OPEN button not visible or not clicked (Not Found Parking Card ID)";
  }
  if (result.vehicleMatched === false) {
    return "Vehicle No. not match in master";
  }
  if (!result.stampSelected) {
    return "Stamp code not selected";
  }
  if (!result.remarkFilled) {
    return "Remark not filled";
  }
  if (!result.confirmClicked) {
    return "Confirm button not clicked";
  }
  if (!result.popupConfirmClicked) {
    return "Popup confirm button not clicked";
  }
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
  let session;

  try {
    const rows = await getSheetDataTodayOnly();
    const masterRows = await getMasterData();

    if (!rows.length) {
      logInfo("No rows found for today");
      return;
    }

    logInfo(`Found ${rows.length} today row(s)`);

    // LOGIN ONLY ONCE
    session = await loginWebsite();

    if (!session.success) {
      const errorMessage =
        session.loginError ||
        session.errorValidate ||
        session.message ||
        "Login failed";

      logError(`Cannot start process because login failed: ${errorMessage}`);
      return;
    }

    for (const row of rows) {
      const fullName = clean(row.E);
      const cardSerial = clean(row.F);
      const vehicleReg = clean(row.D);
      const rowNumber = row.__rowNumber;
      const processDate = getCurrentDateTime();

      logInfo("========================================");
      logInfo(
        `Processing: ${fullName} | Card Serial: ${cardSerial} | Vehicle: ${vehicleReg} | Row: ${rowNumber} | ProcessDate: ${processDate}`
      );

      const ownerCheck = checkOwnerMatch(masterRows, fullName, vehicleReg);

      if (!ownerCheck.success) {
        await safeUpdateRowResult(rowNumber, "automate failed", ownerCheck.reason);
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
        await safeUpdateRowResult(rowNumber, "automate failed", "Card Serial is empty");
        logData({
          success: false,
          fullName,
          cardSerial,
          vehicleReg,
          error: "Card Serial is empty",
        });
        continue;
      }

      try {
        session = await ensureLoggedIn(session);

        let result;

        try {
          result = await searchOpenStampConfirm(
            session.page,
            cardSerial,
            fullName,
            vehicleReg
          );
        } catch (innerError) {
          if ((innerError.message || "").includes("Session expired")) {
            logInfo("Session expired during processing, trying one re-login");

            if (session?.browser) {
              await session.browser.close().catch(() => null);
            }

            session = await loginWebsite();

            if (!session.success) {
              throw new Error(
                session.loginError ||
                  session.errorValidate ||
                  session.message ||
                  "Re-login failed"
              );
            }

            result = await searchOpenStampConfirm(
              session.page,
              cardSerial,
              fullName,
              vehicleReg
            );
          } else {
            throw innerError;
          }
        }

        if (result.success) {
          await safeUpdateRowResult(rowNumber, "Success", "");
        } else {
          const failReason = getFailReason(result);
          await safeUpdateRowResult(rowNumber, "automate failed", failReason);
        }

        logData({
          success: result.success,
          step: result.step,
          fullName,
          cardSerial,
          vehicleReg,
          websiteLicense: result.websiteLicense,
          expectedVehicleReg: result.expectedVehicleReg,
          vehicleMatched: result.vehicleMatched,
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
          error.message || "Unknown error"
        );

        logData({
          success: false,
          fullName,
          cardSerial,
          vehicleReg,
          error: error.message,
        });
      }
    }
  } catch (error) {
    logError(`Error in index.js: ${error.message}`);
  } finally {
    if (session?.browser) {
      await session.browser.close().catch(() => null);
    }
  }
}

main();