const targetConfig = require('./target.js');

const MASTER_OWNER = "Abhi7abhishek";
const MASTER_REPO = "Public-numbers";
const MASTER_FILE_PATH = "getnumbers.txt";

async function runTransferAndDelete() {
    const masterToken = process.env.MASTER_TOKEN;
    const targetToken = process.env.TARGET_TOKEN;

    if (!masterToken || !targetToken) {
        console.log("Error: MASTER_TOKEN ya TARGET_TOKEN environment variable missing hai!");
        return;
    }

    // 1. Master repo se file ki current content aur SHA fetch karo
    const masterUrl = `https://api.github.com/repos/${MASTER_OWNER}/${MASTER_REPO}/contents/${MASTER_FILE_PATH}`;
    const masterGet = await fetch(masterUrl, {
        headers: {
            "Authorization": `token ${masterToken}`,
            "User-Agent": "Node-Bot-Script",
            "Accept": "application/vnd.github.v3+json"
        }
    });

    if (!masterGet.ok) {
        console.log("Master Fetch Error:", await masterGet.text());
        return;
    }

    const masterData = await masterGet.json();
    const masterSha = masterData.sha;
    const originalText = Buffer.from(masterData.content, 'base64').toString('utf8');
    
    // Sabhi valid lines/numbers alag karo
    const allLines = originalText.split(/\r?\n/).map(n => n.trim()).filter(n => n !== "");
    
    if (allLines.length === 0) {
        console.log("Master repo mein koi number nahi bacha hai!");
        return;
    }

    // Pehle 5 numbers alag karo, aur baaki bache hue numbers alag rakho
    const first5 = allLines.slice(0, 5);
    const remainingLines = allLines.slice(5);

    console.log("Master se uthaye gaye 5 numbers:", first5);

    // 2. Target repo ki details target.js se uthao aur SHA check karo
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

    // 3. Un 5 numbers ko target repo mein push karo
    const targetContentEncoded = Buffer.from(first5.join('\n') + '\n').toString('base64');
    const pushRes = await fetch(targetUrl, {
        method: 'PUT',
        headers: {
            "Authorization": `token ${targetToken}`,
            "User-Agent": "Node-Bot-Script",
            "Accept": "application/vnd.github.v3+json",
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            message: "Add 5 test numbers",
            content: targetContentEncoded,
            sha: targetSha ? targetSha : undefined
        })
    });

    if (!pushRes.ok) {
        console.log("Target Push Error:", await pushRes.text());
        return;
    }
    console.log("Success: Target repo mein numbers save ho gaye!");

    // 4. Master repo se wo 5 numbers delete karke baaki list wapas update karo
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
            message: "Remove processed 5 numbers",
            content: updatedMasterContent,
            sha: masterSha
        })
    });

    if (masterUpdateRes.ok) {
        console.log("Success: Master repo se processed numbers hata diye gaye hain!");
    } else {
        console.log("Master Update Error:", await masterUpdateRes.text());
    }
}

runTransferAndDelete();
