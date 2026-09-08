const MASTER_GITHUB_TOKEN = "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";
const MASTER_OWNER = "Abhi7abhishek";
const MASTER_REPO = "Public-numbers";
const MASTER_FILE_PATH = "getnumbers.txt";

async function getOnly5Numbers() {
    const url = `https://api.github.com/repos/${MASTER_OWNER}/${MASTER_REPO}/contents/${MASTER_FILE_PATH}`;
    
    const response = await fetch(url, {
        headers: {
            "Authorization": `token ${MASTER_GITHUB_TOKEN}`,
            "User-Agent": "Node-Test-Script",
            "Accept": "application/vnd.github.v3+json"
        }
    });

    if (!response.ok) {
        const errText = await response.text();
        console.log("Error:", errText);
        return;
    }

    const data = await response.json();
    const content = Buffer.from(data.content, 'base64').toString('utf8');
    const numbers = content.split(/\r?\n/).map(n => n.trim()).filter(n => n !== "");
    
    const first5 = numbers.slice(0, 5);
    console.log("Pehle 5 numbers:", first5);
}

getOnly5Numbers();
