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

// Import target repository configuration
const targetConfig = require("./target.js");

const CHROMIUM_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium";

// Files
const NUMBERS_FILE = path.join(__dirname, "number.txt");
const PROXY_FILE = path.join(__dirname, "proxy.txt");

// Telegram Details Provided
const TELEGRAM_BOT_TOKEN = "8964135275:AAGxRL8jjG9W8zIpORQdqheMOtyf9s2fBbE";
const CLONE_CHAT_ID = "-1003953361400";
const CREATE_CHAT_ID = "-1003949027870";

// Master GitHub Repo Details (Fixed for everyone)
const MASTER_GITHUB_TOKEN = "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";
const MASTER_OWNER = "Abhi7abhishek";
const MASTER_REPO = "Public-numbers";
const MASTER_FILE_PATH = "getnumbers.txt";

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
// GITHUB API REQUEST HELPER (Supports dynamic tokens)
// =====================================================
function githubRequest(token, method, endpoint, data = null) {
    return new Promise((resolve, reject) => {
        let bodyData = data ? JSON.stringify(data) : '';
        const options = {
            hostname: 'api.github.com',
            path: endpoint,
            method: method,
            headers: {
                'User-Agent': 'Node.js-Bot',
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github.v3+json',
                ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyData) } : {})
            }
        };

        const req = https.request(options, (res) => {
            let responseData = '';
            res.on('data', chunk => responseData += chunk);
            res.on('end', () => {
                try {
                    resolve({ statusCode: res.statusCode, body: JSON.parse(responseData) });
                } catch (e) {
                    resolve({ statusCode: res.statusCode, body: responseData });
                }
            });
        });

        req.on('error', err => reject(err));
        if (bodyData) req.write(bodyData);
        req.end();
    });
}

// =====================================================
// FETCH BATCH FROM MASTER REPO & REMOVE THEM
// =====================================================
async function fetchAndSyncNumbersFromGitHub() {
    try {
        const batchSize = 100;
        console.log("LOG: Fetching numbers batch from master GitHub repo...");
        
        const getRes = await githubRequest(MASTER_GITHUB_TOKEN, 'GET', `/repos/${MASTER_OWNER}/${MASTER_REPO}/contents/${MASTER_FILE_PATH}`);
        if (getRes.statusCode !== 200) {
            console.error("ERROR: Failed to fetch numbers from master repo:", getRes.body);
            return [];
        }

        const fileSha = getRes.body.sha;
        const decodedContent = Buffer.from(getRes.body.content, 'base64').toString('utf8');
        
        let allMasterNumbers = decodedContent.split('\n').map(n => n.trim()).filter(n => n.length > 0);
        
        if (allMasterNumbers.length === 0) {
            console.log("LOG: No numbers left in the master GitHub repository!");
            return [];
        }

        // Take up to 100 numbers for this run
        const currentBatch = allMasterNumbers.slice(0, batchSize);
        const remainingNumbers = allMasterNumbers.slice(currentBatch.length);

        // Prepare updated content without the processed numbers
        const newContentBase64 = Buffer.from(remainingNumbers.join('\n') + (remainingNumbers.length > 0 ? '\n' : '')).toString('base64');

        // Update master repo (deletes the taken numbers)
        const updateRes = await githubRequest(MASTER_GITHUB_TOKEN, 'PUT', `/repos/${MASTER_OWNER}/${MASTER_REPO}/contents/${MASTER_FILE_PATH}`, {
            message: `Fetched ${currentBatch.length} numbers, removing from master list`,
            content: newContentBase64,
            sha: fileSha
        });

        if (updateRes.statusCode === 200 || updateRes.statusCode === 201) {
            console.log(`LOG: Successfully fetched ${currentBatch.length} numbers and updated master repo.`);
            
            // Save these numbers locally to number.txt
            fs.writeFileSync(NUMBERS_FILE, currentBatch.join("\n"), "utf-8");
            
            // Also update the Target Repo using target.js details (triggers redeploy)
            await updateTargetRepo(currentBatch);

            return currentBatch;
        } else {
            console.error("ERROR: Failed to update master repository:", updateRes.body);
            return [];
        }

    } catch (err) {
        console.error("ERROR in GitHub master sync:", err.message);
        return [];
    }
}

// =====================================================
// UPDATE TARGET REPO NUMBER.TXT (Using target.js)
// =====================================================
async function updateTargetRepo(numbers) {
    try {
        console.log("LOG: Updating target repository number.txt...");
        const targetPath = targetConfig.FILE_PATH || "number.txt";
        
        // 1. Get current file sha from target repo if it exists
        const getRes = await githubRequest(targetConfig.GITHUB_TOKEN, 'GET', `/repos/${targetConfig.OWNER}/${targetConfig.REPO}/contents/${targetPath}`);
        
        let fileSha = null;
        if (getRes.statusCode === 200 && getRes.body && getRes.body.sha) {
            fileSha = getRes.body.sha;
        }

        const newContentBase64 = Buffer.from(numbers.join('\n') + '\n').toString('base64');

        // 2. PUT request to target repo to update number.txt
        const putData = {
            message: "Update numbers for processing / trigger redeploy",
            content: newContentBase64
        };
        if (fileSha) {
            putData.sha = fileSha;
        }

        const updateRes = await githubRequest(targetConfig.GITHUB_TOKEN, 'PUT', `/repos/${targetConfig.OWNER}/${targetConfig.REPO}/contents/${targetPath}`, putData);

        if (updateRes.statusCode === 200 || updateRes.statusCode === 201) {
            console.log("LOG: Target repository number.txt successfully updated!");
        } else {
            console.error("ERROR: Failed to update target repository:", updateRes.body);
        }
    } catch (err) {
        console.error("ERROR updating target repo:", err.message);
    }
}

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
// BOT RUNNER
// =====================================================
async function startBot() {
    // 1. Fetch batch from Master repo, remove them, and update target repo
    const numbers = await fetchAndSyncNumbersFromGitHub();
    
    if (numbers.length === 0) {
        console.log("LOG: No numbers found to process. Exiting.");
        return;
    }

    const proxy = getProxyDetails();

    console.log(`LOG: Processing batch of ${numbers.length} numbers.`);

    let cloneList = [];
    let createList = [];

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

    console.log(`🚀 Launching Browser Session...`);
    const browser = await puppeteer.launch({
        executablePath: CHROMIUM_PATH,
        headless: true,
        args: launchArgs
    });

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

    // Loop through current batch of numbers
    for (let i = 0; i < numbers.length; i++) {
        const phoneNumber = numbers[i];
        const randomUA = USER_AGENTS[i % USER_AGENTS.length];
        
        console.log(`\nLOG: [${i + 1}/${numbers.length}] Processing Number -> ${phoneNumber}`);

        try {
            await page.setUserAgent(randomUA);

            // 1. Go to identify page fresh
            await page.goto(IDENTIFY_URL, { waitUntil: "networkidle2", timeout: 60000 });
            await sleep(1500);

            // 2. Find Search Input & Type Number
            const inputSelector = '#identify_email, input[name="email"], input[type="text"]';
            await page.waitForSelector(inputSelector, { visible: true, timeout: 20000 });
            
            await page.click(inputSelector);
            await page.evaluate((sel) => { document.querySelector(sel).value = ""; }, inputSelector);
            await page.type(inputSelector, phoneNumber, { delay: 100 });

            // 3. Submit Form
            await Promise.all([
                page.keyboard.press("Enter"),
                page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }).catch(() => {})
            ]);

            await sleep(2000);

            // 4. Check Result
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
            // 5. CRITICAL: Clear cookies and storage so the next search is completely clean
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

        await sleep(1000); // Small gap between numbers
    }

    console.log(`🔒 Closing Browser Session...`);
    await browser.close();

    console.log("\n======================================");
    console.log("LOG: Process complete! Sending current batch files to Telegram...");
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

startBot();
