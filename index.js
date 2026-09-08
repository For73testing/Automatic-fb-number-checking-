const targetConfig = require('./target.js');

// Master Repo Details (Ye Public hai, iska token env se aayega)
const MASTER_OWNER = "Abhi7abhishek";
const MASTER_REPO = "Public-numbers";
const MASTER_FILE_PATH = "getnumbers.txt";

async function runTransferTest() {
    const masterToken = process.env.MASTER_TOKEN;
    const targetToken = process.env.TARGET_TOKEN;

    if (!masterToken || !targetToken) {
        console.log("Error: MASTER_TOKEN ya TARGET_TOKEN environment variable missing hai!");
        return;
    }

    // 1. Master repo se numbers fetch karo
    const masterUrl = `https://api.github.com/repos/${MASTER_OWNER}/${MASTER_REPO}/contents/${MASTER_FILE_PATH}`;
    const masterRes = await fetch(masterUrl, {
        headers: {
            "Authorization": `token ${masterToken}`,
            "User-Agent": "Node-Bot-Script",
            "Accept": "application/vnd.github.v3+json"
        }
    });

    if (!masterRes.ok) {
        console.log("Master Fetch Error:", await masterRes.text());
        return;
    }

    const masterData = await masterRes.json();
    const content = Buffer.from(masterData.content, 'base64').toString('utf8');
    const numbers = content.split(/\r?\n/).map(n => n.trim()).filter(n => n !== "");
    
    // Testing ke liye sirf pehle 5 numbers
    const first5 = numbers.slice(0, 5);
    console.log("Master se uthaye gaye 5 numbers:", first5);

    // 2. Target repo details target.js se uthao
    const targetUrl = `https://api.github.com/repos/${targetConfig.OWNER}/${targetConfig.REPO}/contents/${targetConfig.FILE_PATH}`;
    
    // Target file ka current SHA nikalna padega update marne ke liye
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
    const updatedContent = Buffer.from(first5.join('\n')).toString('base64');
    const pushRes = await fetch(targetUrl, {
        method: 'PUT',
        headers: {
            "Authorization": `token ${targetToken}`,
            "User-Agent": "Node-Bot-Script",
            "Accept": "application/vnd.github.v3+json",
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            message: "Add 5 test numbers from master",
            content: updatedContent,
            sha: targetSha ? targetSha : undefined
        })
    });

    if (pushRes.ok) {
        console.log("Success: Target repo mein numbers successfully daal diye gaye!");
    } else {
        console.log("Target Push Error:", await pushRes.text());
    }
}

runTransferTest();
