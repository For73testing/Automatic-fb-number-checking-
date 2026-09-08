process.on("uncaughtException", (err) => {
    console.error("CRITICAL UNCATCHED EXCEPTION:", err);
});

process.on("unhandledRejection", (reason) => {
    console.error("CRITICAL UNHANDLED REJECTION:", reason);
});

const puppeteer = require("puppeteer-core");
const fs = require("fs");
const path = require("path");
const https = require("https");
const targetConfig = require("./target.js");

const CHROMIUM_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium";

// Files
const NUMBERS_FILE = path.join(__dirname, "number.txt");
const PROXY_FILE = path.join(__dirname, "proxy.txt");

// Master Repo Details
const MASTER_OWNER = "Abhi7abhishek";
const MASTER_REPO = "Public-numbers";
const MASTER_FILE_PATH = "getnumbers.txt";

// Telegram Details Provided
const TELEGRAM_BOT_TOKEN = "8964135275:AAGxRL8jjG9W8zIpORQdqheMOtyf9s2fBbE";
const CLONE_CHAT_ID = "-1003953361400";
const CREATE_CHAT_ID = "-1003949027870";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Pool of Multiple User Agents for Rotation
const USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.2277.83"
];

// =====================================================
// SEND TEXT MESSAGE TO TELEGRAM
// =====================================================
async function sendTelegramMessage(chatId, text) {
    if (!TELEGRAM_BOT_TOKEN) return;
    const data = JSON.stringify({ chat_id: chatId, text: text });
    
    const options = {
        hostname: 'api.telegram.org',
        port: 443,
        path: `/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': data.length }
    };

    return new Promise((resolve) => {
        const req = https.request(options, (res) => { res.on('data', () => {}); res.on('end', resolve); });
        req.on('error', () => { resolve(); });
        req.write(data);
        req.end();
    });
}

// =====================================================
// SEND FILE DOCUMENT TO TELEGRAM
// =====================================================
async function sendTelegramDocument(chatId, fileBuffer, fileName, caption) {
    if (!TELEGRAM_BOT_TOKEN) return;

    const boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW";
    let body = [];

    body.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n`));
    body.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption}\r\n`));
    body.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="${fileName}"\r\nContent-Type: text/plain\r\n\r\n`));
    body.push(fileBuffer);
    body.push(Buffer.from(`\r\n--${boundary}--\r\n`));

    const payload = Buffer.concat(body);

    const options = {
        hostname: 'api.telegram.org',
        port: 443,
        path: `/bot${TELEGRAM_BOT_TOKEN}/sendDocument`,
        method: 'POST',
        headers: {
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': payload.length
        }
    };

    return new Promise((resolve) => {
        const req = https.request(options, (res) => { res.on('data', () => {}); res.on('end', resolve); });
        req.on('error', () => { resolve(); });
        req.write(payload);
        req.end();
    });
}

// =====================================================
// FETCH NUMBERS FROM MASTER & SYNC WITH TARGET
// =====================================================
async function fetchAndSyncNumbers() {
    const masterToken = process.env.MASTER_TOKEN;
    const targetToken = process.env.TARGET_TOKEN;

    if (!masterToken || !targetToken) {
        console.error("ERROR: MASTER_TOKEN ya TARGET_TOKEN environment variable missing hai!");
        return [];
    }

    console.log("LOG: Fetching numbers from Master Repository...");
    const masterUrl = `https://api.github.com/repos/${MASTER_OWNER}/${MASTER_REPO}/contents/${MASTER_FILE_PATH}`;
    const masterGet = await fetch(masterUrl, {
        headers: {
            "Authorization": `token ${masterToken}`,
            "User-Agent": "Node-Bot-Script",
            "Accept": "application/vnd.github.v3+json"
        }
    });

    if (!masterGet.ok) {
        console.error("Master Fetch Error:", await masterGet.text());
        return [];
    }

    const masterData = await masterGet.json();
    const masterSha = masterData.sha;
    const originalText = Buffer.from(masterData.content, 'base64').toString('utf8');
    
    const allLines = originalText.split(/\r?\n/).map(n => n.trim()).filter(n => n !== "");
    
    if (allLines.length === 0) {
        console.log("LOG: Master repo mein koi number nahi bacha hai!");
        return [];
    }

    // Process up to 100 numbers for this batch
    const batchNumbers = allLines.slice(0, 100);
    const remainingLines = allLines.slice(100);

    console.log(`LOG: Extracted batch of ${batchNumbers.length} numbers from master.`);

    // Target repo details se SHA fetch karo
    const targetUrl = `https://api.github.com/repos/${targetConfig.OWNER}/${targetConfig.REPO}/contents/${targetConfig.FILE_PATH}`;
    let targetSha = "";
    const targetGet = await fetch(targetUrl, {
        headers: {
            "Authorization": `token ${targetToken}`,
            "User-Agent": "Node-Bot-Script",
            "Accept": "application/vnd.github.v3+json"
        }
    });

    if (targetGet.ok) {
        const targetData = await targetGet.json();
        targetSha = targetData.sha;
    }

    // Push batch numbers to target repo (replaces/updates old numbers completely)
    const targetContentEncoded = Buffer.from(batchNumbers.join('\n') + '\n').toString('base64');
    const pushRes = await fetch(targetUrl, {
        method: 'PUT',
        headers: {
            "Authorization": `token ${targetToken}`,
            "User-Agent": "Node-Bot-Script",
            "Accept": "application/vnd.github.v3+json",
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            message: "Update target repository with new batch numbers",
            content: targetContentEncoded,
            sha: targetSha ? targetSha : undefined
        })
    });

    if (!pushRes.ok) {
        console.error("Target Push Error:", await pushRes.text());
        return [];
    }
    console.log("LOG: Batch successfully pushed and updated in target repository.");

    // Remove processed numbers from master repo permanently
    const updatedMasterContent = Buffer.from(remainingLines.join('\n') + (remainingLines.length > 0 ? '\n' : '')).toString('base64');
    const masterUpdateRes = await fetch(masterUrl, {
        method: 'PUT',
        headers: {
            "Authorization": `token ${masterToken}`,
            "User-Agent": "Node-Bot-Script",
            "Accept": "application/vnd.github.v3+json",
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            message: "Remove processed batch numbers",
            content: updatedMasterContent,
            sha: masterSha
        })
    });

    if (!masterUpdateRes.ok) {
        console.error("Master Update Error:", await masterUpdateRes.text());
    } else {
        console.log("LOG: Processed numbers successfully removed from master repository.");
    }

    // Save fetched numbers locally into number.txt
    fs.writeFileSync(NUMBERS_FILE, batchNumbers.join('\n') + '\n', 'utf-8');
    return batchNumbers;
}

// =====================================================
// READ NUMBERS (LOCAL FALLBACK TO MASTER SYNC)
// =====================================================
function getNumbersList() {
    if (fs.existsSync(NUMBERS_FILE)) {
        const content = fs.readFileSync(NUMBERS_FILE, "utf-8");
        const numbers = content.split("\n").map(n => n.trim()).filter(n => n.length > 0);
        if (numbers.length > 0) {
            console.log(`LOG: Loaded ${numbers.length} numbers from local number.txt.`);
            return numbers;
        }
    }
    console.log("LOG: Local number.txt is empty or missing. Fetching new batch from master repo...");
    return [];
}

// =====================================================
// READ & PARSE PROXY (HTTP SUPPORT)
// =====================================================
function getProxyDetails() {
    if (!fs.existsSync(PROXY_FILE)) {
        console.log("LOG: proxy.txt nahi mili, direct connection use hoga.");
        return null;
    }
    
    const content = fs.readFileSync(PROXY_FILE, "utf-8").trim();
    const lines = content.split("\n").map(l => l.trim()).filter(l => l.length > 0);

    if (lines.length === 0) return null;

    const parts = lines[0].split(":");

    if (parts.length === 4) {
        return {
            host: parts[0].trim(),
            port: parts[1].trim(),
            username: parts[2].trim(),
            password: parts[3].trim()
        };
    } else if (parts.length === 3) {
        return {
            host: parts[0].trim(),
            port: "7778",
            username: parts[1].trim(),
            password: parts[2].trim()
        };
    }

    console.error("ERROR: proxy.txt ka format sahi nahi hai!");
    return null;
}

// =====================================================
// PROCESS SINGLE BATCH OF NUMBERS
// =====================================================
async function processBatch(numbers, browser, proxy) {
    const page = await browser.newPage();

    if (proxy && proxy.username && proxy.password) {
        await page.authenticate({
            username: proxy.username,
            password: proxy.password
        });
    }

    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    });

    await page.setViewport({ width: 1366, height: 768 });

    const IDENTIFY_URL = "https://www.facebook.com/login/identify/";
    let cloneList = [];
    let createList = [];

    for (let i = 0; i < numbers.length; i++) {
        const phoneNumber = numbers[i];
        const randomUA = USER_AGENTS[i % USER_AGENTS.length];
        
        console.log(`\nLOG: [${i + 1}/${numbers.length}] Processing Number -> ${phoneNumber}`);

        try {
            await page.setUserAgent(randomUA);

            await page.goto(IDENTIFY_URL, { waitUntil: "networkidle2", timeout: 60000 });
            await sleep(1500);

            const inputSelector = '#identify_email, input[name="email"], input[type="text"]';
            await page.waitForSelector(inputSelector, { visible: true, timeout: 20000 });
            
            await page.click(inputSelector);
            await page.evaluate((sel) => { document.querySelector(sel).value = ""; }, inputSelector);
            await page.type(inputSelector, phoneNumber, { delay: 100 });

            await Promise.all([
                page.keyboard.press("Enter"),
                page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }).catch(() => {})
            ]);

            await sleep(2000);

            const pageText = await page.evaluate(() => document.body.innerText);

            if (
                pageText.includes("No search results") || 
                pageText.includes("No account found") || 
                pageText.includes("Your search did not return any results") ||
                pageText.includes("We couldn't find an account")
            ) {
                console.log(`❌ RESULT: [${phoneNumber}] -> No Account Found.`);
                createList.push(phoneNumber);
                await sendTelegramMessage(CREATE_CHAT_ID, `❌ Create Account: ${phoneNumber}`);
            } else {
                console.log(`✅ RESULT: [${phoneNumber}] -> Account Found!`);
                cloneList.push(phoneNumber);
                await sendTelegramMessage(CLONE_CHAT_ID, `✅ Clone Account Found: ${phoneNumber}`);
            }

        } catch (err) {
            console.error(`ERROR processing number ${phoneNumber}:`, err.message);
            createList.push(phoneNumber);
            await sendTelegramMessage(CREATE_CHAT_ID, `❌ Create Account: ${phoneNumber}`);
        } finally {
            try {
                const client = await page.target().createCDPSession();
                await client.send('Network.clearBrowserCookies');
                await client.send('Network.clearBrowserCache');
            } catch (e) {
                try {
                    const cookies = await page.cookies();
                    if (cookies.length > 0) {
                        await page.deleteCookie(...cookies);
                    }
                } catch(err2) {}
            }
        }

        await sleep(1000);
    }

    await page.close();

    console.log("\n======================================");
    console.log("LOG: Batch complete! Sending files to Telegram...");
    console.log("======================================\n");

    if (cloneList.length > 0) {
        const cloneBuffer = Buffer.from(cloneList.join("\n"), "utf-8");
        await sendTelegramDocument(CLONE_CHAT_ID, cloneBuffer, "clone.txt", "📁 Current Batch Clone Numbers List");
    }

    if (createList.length > 0) {
        const createBuffer = Buffer.from(createList.join("\n"), "utf-8");
        await sendTelegramDocument(CREATE_CHAT_ID, createBuffer, "create.txt", "📁 Current Batch Create Numbers List");
    }
}

// =====================================================
// CONTINUOUS BOT RUNNER (LOOP)
// =====================================================
async function startBot() {
    const proxy = getProxyDetails();

    const launchArgs = [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-blink-features=AutomationControlled",
        "--window-size=1366,768",
        "--lang=en-US,en"
    ];

    if (proxy) {
        launchArgs.push(`--proxy-server=http://${proxy.host}:${proxy.port}`);
    }

    console.log(`🚀 Launching Persistent Browser Session...`);
    const browser = await puppeteer.launch({
        executablePath: CHROMIUM_PATH,
        headless: true,
        args: launchArgs
    });

    try {
        while (true) {
            // 1. Check local file, if empty fetch next batch from master repo & update target repo
            let numbers = getNumbersList();

            if (numbers.length === 0) {
                numbers = await fetchAndSyncNumbers();
            }

            // If master repo is also empty, stop loop
            if (numbers.length === 0) {
                console.log("LOG: Sabhi numbers khatam ho gaye hain. Process stop ho raha hai.");
                break;
            }

            console.log(`LOG: Processing current batch of ${numbers.length} numbers.`);

            // 2. Process the batch and send to Telegram
            await processBatch(numbers, browser, proxy);

            // 3. Clear local number.txt so next iteration fetches the fresh batch from master repo
            if (fs.existsSync(NUMBERS_FILE)) {
                fs.writeFileSync(NUMBERS_FILE, "", "utf-8");
            }

            console.log("LOG: Batch finished. Moving to next batch automatically...\n");
            await sleep(3000);
        }
    } catch (err) {
        console.error("CRITICAL ERROR IN MAIN LOOP:", err);
    } finally {
        console.log(`🔒 Closing Browser Session...`);
        await browser.close();
    }
}

startBot();
