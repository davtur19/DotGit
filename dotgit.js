import "/lib/jszip.min.js";
import "/lib/pako_inflate.min.js";

const DEFAULT_OPTIONS = {
    "functions": {
        "git": true,
        "svn": false,
        "hg": false,
        "env": false,
        "ds_store": false
    },
    "color": "grey",
    "max_sites": 100,
    "notification": {
        "new_git": true,
        "download": true
    },
    "check_opensource": true,
    "check_securitytxt": true,
    "debug": false,
    "download": {
        "wait": 100,
        "max_wait": 10000,
        "max_connections": 20,
        "failed_in_a_row": 250
    },
    "blacklist": [
        'localhost'
    ]
};

const WS_SEARCH = /(ws)(s)?:\/\//;
const WS_REPLACE = "http$2://";

const GIT_PATH = "/.git/";
const GIT_HEAD_PATH = GIT_PATH + "HEAD";
const GIT_CONFIG_PATH = GIT_PATH + "config";
const GIT_HEAD_HEADER = "ref: refs/heads/";

const SVN_PATH = "/.svn/";
const SVN_DB_PATH = SVN_PATH + "wc.db";
const SVN_DB_HEADER = "SQLite";

const HG_PATH = "/.hg/";
const HG_MANIFEST_PATH = HG_PATH + "store/00manifest.i";
const HG_MANIFEST_HEADERS = [
    "\u0000\u0000\u0000\u0001",
    "\u0000\u0001\u0000\u0001",
    "\u0000\u0002\u0000\u0001",
    "\u0000\u0003\u0000\u0001",
];

const ENV_PATH = "/.env";
const ENV_SEARCH = "^[A-Z_]+=|^[#\\n\\r ][\\s\\S]*^[A-Z_]+=";

const DS_STORE = "/.DS_Store";
const DS_STORE_HEADER = "\x00\x00\x00\x01Bud1";

const GIT_TREE_HEADER = "tree ";
const GIT_OBJECTS_PATH = "objects/";
const GIT_OBJECTS_SEARCH = "[a-f0-9]{40}";
const GIT_CONFIG_SEARCH = "url = (.*(github\\.com|gitlab\\.com).*)";
const GIT_PACK_PATH = "objects/pack/";
const GIT_PACK_SEARCH = "pack\-[a-f0-9]{40}";
const GIT_PACK_EXT = ".pack";
const GIT_IDX_EXT = ".idx";
const SHA1_SIZE = 20;
const GIT_BLOB_DELIMITER = String.fromCharCode(0);
const STATUS_DESCRIPTION = "HTTP Status code for downloaded files: 200 Good, 404 Normal, 403 and 5XX Bad\n";

const SECURITYTXT_PATHS = [
    "/.well-known/security.txt",
    "/security.txt",
];
const SECURITYTXT_SEARCH = "Contact: ";

const GIT_WELL_KNOW_PATHS = [
    "HEAD",
    "ORIG_HEAD",
    "description",
    "config",
    "COMMIT_EDITMSG",
    "index",
    "packed-refs",
    "objects/info/packs",
    "refs/heads/master",
    "refs/heads/main",
    "refs/remotes/origin/HEAD",
    "refs/stash",
    "logs/HEAD",
    "logs/refs/stash",
    "logs/refs/heads/master",
    "logs/refs/heads/main",
    "logs/refs/remotes/origin/HEAD",
    "info/refs",
    "info/exclude"
];

let wait;
let max_wait;
let max_connections;
let notification_new_git;
let notification_download;
let check_opensource;
let check_securitytxt;
let check_git;
let check_svn;
let check_hg;
let check_env;
let check_ds_store;
let failed_in_a_row;
let blacklist = [];
let processingUrls = new Set();
let debug;

function debugLog(...args) {
    if (debug) {
        console.log('[DotGit Debug]', ...args);
    }
}

function notification(title, message) {
    if (title === "Download status") {
        if (!notification_download) {
            return true;
        }
    } else {
        if (!notification_new_git) {
            return true;
        }
    }

    chrome.notifications.create({
        type: "basic",
        iconUrl: chrome.runtime.getURL("icons/dotgit-48.png"),
        title: title,
        message: message
    });
}


function sendDownloadStatus(url, downloadStatus) {
    let message = {
        type: "downloadStatus",
        url: url,
        downloadStatus: downloadStatus
    };

    chrome.runtime.sendMessage(message, function () {
        // suppress error for sendMessage
        // noinspection BadExpressionStatementJS
        chrome.runtime.lastError;
    });
}

// it may happen that the badge is set at the same time by several checks, in this way it could be increased only once
function setBadge() {
    // Not supported on Firefox for Android
    if (typeof chrome.browserAction !== "undefined" && typeof chrome.browserAction.setBadgeText !== "undefined") {
        chrome.browserAction.getBadgeText({}, function (result) {
            let n = parseInt(result);
            let text = (isNaN(n) ? 0 : n) + 1;
            chrome.browserAction.setBadgeText({
                text: text.toString()
            });
        });
    } else if (typeof chrome.action !== "undefined" && typeof chrome.action.setBadgeText !== "undefined") {
        chrome.action.getBadgeText({}, function (result) {
            let n = parseInt(result);
            let text = (isNaN(n) ? 0 : n) + 1;
            chrome.action.setBadgeText({
                text: text.toString()
            });
        });
    }
}


async function fetchWithTimeout(resource, options) {
    const {timeout = 10000} = options;

    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(resource, {
        ...options,
        signal: controller.signal
    });
    clearTimeout(id);

    return response;
}


async function checkGit(url) {
    const to_check = url + GIT_HEAD_PATH;
    const search = new RegExp(GIT_OBJECTS_SEARCH, "y");

    try {
        const response = await fetchWithTimeout(to_check, {
            redirect: "manual",
            timeout: 10000
        });

        if (response.status === 200) {
            let text = await response.text();
            if (text !== false && (text.startsWith(GIT_HEAD_HEADER) === true || search.test(text) === true)) {
                // .git found
                setBadge();
                notification("Found an exposed .git", to_check);
                return true;
            }
        }
    } catch (error) {
        // Timeouts if the request takes longer than X seconds
        //console.log(error.name);
    }

    return false;
}

async function checkSvn(url) {
    const to_check = url + SVN_DB_PATH;

    try {
        const response = await fetchWithTimeout(to_check, {
            redirect: "manual",
            timeout: 10000
        });

        if (response.status === 200) {
            let text = await response.text();
            if (text !== false && text.startsWith(SVN_DB_HEADER) === true) {
                // .svn found
                setBadge();
                notification("Found an exposed .svn", to_check);
                return true;
            }
        }
    } catch (error) {
        // Timeouts if the request takes longer than X seconds
        //console.log(error.name);
    }

    return false;
}

async function checkHg(url) {
    const to_check = url + HG_MANIFEST_PATH;

    try {
        const response = await fetchWithTimeout(to_check, {
            redirect: "manual",
            timeout: 10000
        });

        if (response.status === 200) {
            let text = await response.text();
            if (text !== false && (
                text.startsWith(HG_MANIFEST_HEADERS[0]) === true ||
                text.startsWith(HG_MANIFEST_HEADERS[1]) === true ||
                text.startsWith(HG_MANIFEST_HEADERS[2]) === true ||
                text.startsWith(HG_MANIFEST_HEADERS[3]) === true)
            ) {
                // .hg found
                setBadge();
                notification("Found an exposed .hg", to_check);
                return true;
            }
        }
    } catch (error) {
        // Timeouts if the request takes longer than X seconds
        //console.log(error.name);
    }

    return false;
}

async function checkEnv(url) {
    const to_check = url + ENV_PATH;
    const search = new RegExp(ENV_SEARCH, "g");

    try {
        const response = await fetchWithTimeout(to_check, {
            redirect: "manual",
            timeout: 10000
        });

        if (response.status === 200) {
            let text = await response.text();
            if (text !== false && search.test(text) === true) {
                // .env found
                setBadge();
                notification("Found an exposed .env", to_check);
                return true;
            }
        }
    } catch (error) {
        // Timeouts if the request takes longer than X seconds
        //console.log(error.name);
    }

    return false;
}

async function checkDSStore(url) {
    const to_check = url + DS_STORE;

    try {
        const response = await fetchWithTimeout(to_check, {
            redirect: "manual",
            timeout: 10000
        });

        if (response.status === 200) {
            let text = await response.text();
            if (text !== false && text.startsWith(DS_STORE_HEADER[0]) === true) {

                setBadge();
                notification("Found an exposed .DS_Store", to_check);
                return true;
            }
        }
    } catch (error) {
        // Timeouts if the request takes longer than X seconds
        //console.log(error.name);
    }

    return false;
}


function startDownload(baseUrl, downloadFinished) {
    const downloadedFiles = [];
    const walkedPaths = [];

    let running_tasks = 0;
    let waiting = 0;
    let fileExist = false;
    let downloadStats = {};
    let failedInARow = 0;
    let downloadStatus = {
        successful: 0,
        failed: 0,
        total: 0
    }

    // slow conversion
    function arrayBufferToString(buffer) {
        let result = "";

        buffer.forEach(function (part) {
            result += String.fromCharCode(part);
        });

        return result;
    }

    // make zip
    function downloadZip() {
        if (running_tasks === 0 && waiting === 0) {
            notification("Download status", "Creating zip...");
            let zip = new JSZip();
            let filename = baseUrl.replace(/^http(s?):\/\//i, "").replace(/[.:@]/g, "_");
            let strStatus = STATUS_DESCRIPTION;

            downloadedFiles.forEach(function (file) {
                zip.file(filename + GIT_PATH + file[0], file[1], {arrayBuffer: true});
            });

            Object.keys(downloadStats).forEach(function (key) {
                strStatus += "\n" + key + ": " + downloadStats[key];
            });
            zip.file("DownloadStats.txt", strStatus);

            if (typeof URL.createObjectURL === 'function') {
                // FireFox download
                zip.generateAsync({type: "blob"}).then(function (zipBlob) {
                    chrome.downloads.download({
                        url: URL.createObjectURL(zipBlob),
                        filename: `${filename}.zip`
                    });
                    downloadFinished(fileExist, downloadStats);
                });
            } else {
                // Chrome download
                zip.generateAsync({type: "base64"}).then(function (zipData) {
                    chrome.downloads.download({
                        url: `data:application/octet-stream;base64,${zipData}`,
                        filename: `${filename}.zip`
                    });
                    downloadFinished(fileExist, downloadStats);
                });
            }
        }
    }


    function downloadFile(path, decompress, callback) {
        if (walkedPaths.includes(path)) {
            downloadZip();
            return;
        }
        if (failedInARow > failed_in_a_row) {
            downloadZip();
            return;
        }

        // waiting = number of pending downloads
        // running_tasks = number of downloads in progress
        // max_connections = maximum number of simultaneous connections
        // wait = wait time based on pending downloads
        // max_wait = max wait time
        if (running_tasks >= max_connections) {
            waiting++;
            setTimeout(function () {
                waiting--;
                downloadFile(path, decompress, callback);
            }, ((waiting * wait) <= max_wait) ? (waiting * wait) : max_wait);
        } else {
            //download
            walkedPaths.push(path);
            running_tasks++;
            downloadStatus.total++;

            fetch(baseUrl + GIT_PATH + path, {
                redirect: "manual",
                headers: {"Accept": "text/html"},
            }).then(function (response) {
                downloadStats[response.status] = (typeof downloadStats[response.status] === "undefined") ? 1 : downloadStats[response.status] + 1;
                // ignore status code?
                if (response.ok && response.status === 200) {
                    fileExist = true;
                    downloadStatus.successful++;
                    failedInARow = 0;
                    sendDownloadStatus(baseUrl, downloadStatus);
                    return response.arrayBuffer();
                }
                running_tasks--;
                downloadStatus.failed++;
                failedInARow++;
                sendDownloadStatus(baseUrl, downloadStatus);
            }).then(function (buffer) {
                if (typeof buffer !== "undefined") {
                    downloadedFiles.push([path, buffer]);
                    // noinspection JSCheckFunctionSignatures
                    const words = new Uint8Array(buffer);

                    if (decompress) {
                        // decompress objects
                        try {
                            let data = pako.ungzip(words);
                            callback(arrayBufferToString(data));
                        } catch (e) {
                            // do nothing
                        }
                    } else {
                        // plaintext file
                        callback(arrayBufferToString(words));
                    }
                    running_tasks--;
                }
                downloadZip();
            });
        }
    }


    function checkTree(result) {
        if (result.startsWith(GIT_TREE_HEADER)) {
            for (let i = 0; i < result.length; i++) {
                if (result[i] === GIT_BLOB_DELIMITER && i + 1 + SHA1_SIZE <= result.length) {
                    let hash = "";

                    for (let j = i + 1; j < i + 1 + SHA1_SIZE; j++) {
                        // bin to hex
                        let chr = result.charCodeAt(j).toString(16);
                        hash += chr.length < 2 ? "0" + chr : chr;
                    }

                    // make object path and download
                    let path = GIT_OBJECTS_PATH + hash.slice(0, 2) + "/" + hash.slice(2);
                    downloadFile(path, true, checkResult);
                }
            }
        }
    }


    function checkObject(result) {
        let matches;
        const search = new RegExp(GIT_OBJECTS_SEARCH, "g");

        while ((matches = search.exec(result)) !== null) {
            // This is necessary to avoid infinite loops with zero-width matches
            if (matches.index === search.lastIndex) {
                search.lastIndex++;
            }


            for (let i = 0; i < matches.length; i++) {
                // make object path and download
                let path = GIT_OBJECTS_PATH + matches[i].slice(0, 2) + "/" + matches[i].slice(2);
                downloadFile(path, true, checkResult);
            }
        }
    }


    function checkPack(result) {
        let matches;
        const search = new RegExp(GIT_PACK_SEARCH, "g");

        while ((matches = search.exec(result)) !== null) {
            // This is necessary to avoid infinite loops with zero-width matches
            if (matches.index === search.lastIndex) {
                search.lastIndex++;
            }

            for (let i = 0; i < matches.length; i++) {
                let pathExt = GIT_PACK_PATH + matches[i] + GIT_PACK_EXT;
                let pathIdx = GIT_PACK_PATH + matches[i] + GIT_IDX_EXT;
                downloadFile(pathExt, false, function () {
                });
                downloadFile(pathIdx, false, function () {
                });
            }
        }
    }


    function checkResult(result) {
        checkTree(result);
        checkObject(result);
        checkPack(result);
    }

    // start download from well know paths
    for (let i = 0; i < GIT_WELL_KNOW_PATHS.length; i++) {
        downloadFile(GIT_WELL_KNOW_PATHS[i], false, checkResult);
    }
}


function set_options(options) {
    wait = options.download.wait;
    max_wait = options.download.max_wait;
    max_connections = options.download.max_connections;
    failed_in_a_row = options.download.failed_in_a_row;
    notification_new_git = options.notification.new_git;
    notification_download = options.notification.download;
    check_opensource = options.check_opensource;
    check_securitytxt = options.check_securitytxt;
    check_git = options.functions.git;
    check_svn = options.functions.svn;
    check_hg = options.functions.hg;
    check_env = options.functions.env;
    check_ds_store = options.functions.ds_store;
    debug = options.debug;
    blacklist = options.blacklist;
}


function checkOptions(default_options, storage_options) {
    for (let [key] of Object.entries(default_options)) {
        if (typeof storage_options[key] === "object") {
            storage_options[key] = checkOptions(default_options[key], storage_options[key]);
        } else if (typeof storage_options[key] === "undefined") {
            storage_options[key] = default_options[key];
        }
    }
    return storage_options;
}


chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    debugLog('Received message:', msg);
    
    if (msg.type === "GIT_FOUND") {
        debugLog('Git repository found at:', msg.url);
        
        chrome.storage.local.get(["withExposedGit"], function(result) {
            const withExposedGit = result.withExposedGit || [];
            
            if (!withExposedGit.some(item => item.url === msg.url)) {
                debugLog('Adding new Git repository to list');
                withExposedGit.push({
                    type: "git",
                    url: msg.url,
                    open: false,
                    securitytxt: false
                });
                
                chrome.storage.local.set({ withExposedGit: withExposedGit }, function() {
                    debugLog('Storage updated');
                    setBadge();
                    
                    chrome.notifications.create({
                        type: "basic",
                        iconUrl: chrome.runtime.getURL("icons/dotgit-48.png"),
                        title: ".git esposto!",
                        message: `Repository Git esposto su: ${msg.url}`
                    });
                });
            } else {
                debugLog('Git repository already in list');
            }
        });
        return true;
    } else if (msg.type === "download") {
        debugLog('Starting download for:', msg.url);
        notification("Download status", "Download started\nPlease wait...");

        startDownload(msg.url, function (fileExist, downloadStats) {
            let strStatus = "";

            chrome.storage.local.get(["downloading"], function (downloading) {
                if (typeof downloading.downloading !== "undefined" && downloading.downloading.length !== 0) {
                    let index = downloading.downloading.indexOf(msg.url);
                    if (index > -1) {
                        downloading.downloading.splice(index, 1);
                    }
                    chrome.storage.local.set({
                        downloading: downloading.downloading
                    });
                }
            });

            Object.keys(downloadStats).forEach(function (key) {
                strStatus += key + ": " + downloadStats[key] + "\n";
            });
            if (fileExist) {
                notification("Download status", "Downloaded " + msg.url + "\n" + strStatus);
                sendResponse({status: true});
            } else {
                notification("Download status", "Failed to download " + msg.url + "\nNo files found\n" + strStatus);
                sendResponse({status: false});
            }
        });
    } else if (msg.type === "git") {
        check_git = msg.value;
        sendResponse({status: true});
    } else if (msg.type === "svn") {
        check_svn = msg.value;
        sendResponse({status: true});
    } else if (msg.type === "hg") {
        check_hg = msg.value;
        sendResponse({status: true});
    } else if (msg.type === "env") {
        check_env = msg.value;
        sendResponse({status: true});
    } else if (msg.type === "ds_store") {
        check_ds_store = msg.value;
    } else if (msg.type === "notification_new_git") {
        notification_new_git = msg.value;
        sendResponse({status: true});
    } else if (msg.type === "notification_download") {
        notification_download = msg.value;
        sendResponse({status: true});
    } else if (msg.type === "check_opensource") {
        check_opensource = msg.value;
        sendResponse({status: true});
    } else if (msg.type === "check_securitytxt") {
        check_securitytxt = msg.value;
        sendResponse({status: true});
    } else if (msg.type === "debug") {
        debug = msg.value;
        sendResponse({status: true});
    } else if (msg.type === "blacklist") {
        blacklist = msg.value;
        sendResponse({status: true});
    } else if (msg.type === "max_connections") {
        max_connections = msg.value;
        sendResponse({status: true});
    } else if (msg.type === "wait") {
        wait = msg.value;
        sendResponse({status: true});
    } else if (msg.type === "max_wait") {
        max_wait = msg.value;
        sendResponse({status: true});
    } else if (msg.type === "failed_in_a_row") {
        failed_in_a_row = msg.value;
        sendResponse({status: true});
    } else if (msg.type === "reset_options") {
        chrome.storage.local.set({options: DEFAULT_OPTIONS});
        set_options(DEFAULT_OPTIONS);
        sendResponse({status: true, options: DEFAULT_OPTIONS});
    } else if (msg.type === "REQUEST_GIT_CHECK") {
        const {origin, pageUrl} = msg;

        chrome.storage.local.get(["options", "checked"], (result) => {
            const options = result.options || DEFAULT_OPTIONS;
            const alreadyChecked = result.checked || [];

            const isEnabled = options.functions.git;
            const alreadyDone = alreadyChecked.includes(origin);

            debugLog("Already checked: ", alreadyChecked);
            debugLog("Is enabled: ", isEnabled);

            if (!isEnabled || alreadyDone) {
                return sendResponse({shouldFetch: false});
            }

            // Puoi anche aggiornare checked subito qui
            alreadyChecked.push(origin);
            chrome.storage.local.set({checked: alreadyChecked});

            sendResponse({shouldFetch: true});
        });

        // Necessario per risposte asincrone
        return true;
    } else if (msg.type === "GIT_FETCH_RESULT") {
        const {gitUrl, gitHeadContent, pageUrl} = msg;

        chrome.storage.local.get(["options", "withExposedGit"], (result) => {
            const options = result.options || DEFAULT_OPTIONS;
            const exposed = result.withExposedGit || [];

            if (!options.functions.git) return;

            if (gitHeadContent.includes("ref:")) {
                if (!exposed.some(e => e.url === gitUrl)) {
                    exposed.push({type: "git", url: new URL(pageUrl).hostname});
                    chrome.storage.local.set({withExposedGit: exposed});
                }

                chrome.notifications.create({
                    type: "basic",
                    iconUrl: "icons/dotgit-96.png",
                    title: ".git esposto!",
                    message: `Trovato su: ${new URL(pageUrl).hostname}`
                });
            }
        });
    }


    // this will keep the message channel open to the other end until sendResponse is called
    return true;
});


chrome.storage.local.get(["checked", "withExposedGit", "options"], function (result) {
    // Initialize the saved stats if not yet initialized.
    if (typeof result.checked === "undefined") {
        result = {
            checked: [],
            withExposedGit: []
        };
        chrome.storage.local.set(result);
    }
    if (typeof result.options === "undefined") {
        result.options = DEFAULT_OPTIONS;
        chrome.storage.local.set({options: DEFAULT_OPTIONS});
    }
    // upgrade 3.7.4 => 4.0
    if (typeof result.options.functions === "undefined" || (typeof result.withExposedGit[0] !== "undefined" && typeof result.withExposedGit[0].type === "undefined")) {
        let urls = [];
        result.options.functions = DEFAULT_OPTIONS.functions;
        result.withExposedGit.forEach(function (url) {
            urls.push({type: "git", url: url});
        });
        result.withExposedGit = urls;
        chrome.storage.local.set({withExposedGit: result.withExposedGit});
    }

    chrome.storage.local.set({options: checkOptions(DEFAULT_OPTIONS, result.options)});

    set_options(result.options);

    chrome.webRequest.onHeadersReceived.addListener(details => processListener(details), {urls: ["<all_urls>"]});
});

// Reset download status at each start
chrome.storage.local.set({
    downloading: []
});


async function processListener(details) {
    const origin = new URL(details.url).origin;
    debugLog('Processing request for:', details.url);
    debugLog('Origin:', origin);

    // Controllo preventivo per URL già in elaborazione
    if (processingUrls.has(origin)) {
        debugLog('URL already being processed, skipping:', origin);
        return;
    }

    try {
        const result = await chrome.storage.local.get(["checked", "withExposedGit", "options"]);
        const options = result.options || DEFAULT_OPTIONS;
        const alreadyChecked = result.checked || [];
        debugLog('Already checked URLs:', alreadyChecked);

        // Skip if already checked or in blacklist
        if (alreadyChecked.includes(origin) || checkBlacklist(new URL(origin).hostname)) {
            debugLog('URL already checked or in blacklist, skipping:', origin);
            return;
        }

        // Aggiungi l'URL a quelli in elaborazione
        processingUrls.add(origin);

        // Mark as checked immediately to prevent duplicate checks
        alreadyChecked.push(origin);
        await chrome.storage.local.set({checked: alreadyChecked});

        // Send message to content script to perform checks
        const tabs = await chrome.tabs.query({});
        debugLog('Found tabs:', tabs.length);
        
        const matchedTab = tabs.find((tab) => {
            try {
                const url = new URL(tab.url);
                return url.origin === origin;
            } catch (e) {
                return false;
            }
        });

        if (matchedTab) {
            debugLog('Found matching tab:', matchedTab.url);
            try {
                // First check if content script is available
                const isContentScriptAvailable = await new Promise((resolve) => {
                    chrome.tabs.sendMessage(matchedTab.id, { type: "PING" }, response => {
                        if (chrome.runtime.lastError) {
                            debugLog('Content script not available');
                            resolve(false);
                        } else {
                            debugLog('Content script responded to ping');
                            resolve(true);
                        }
                    });
                });

                // If content script is not available, inject it
                if (!isContentScriptAvailable) {
                    debugLog('Injecting content script');
                    await chrome.scripting.executeScript({
                        target: { tabId: matchedTab.id },
                        files: ['content_script.js']
                    });
                    // Wait a bit for the script to initialize
                    await new Promise(resolve => setTimeout(resolve, 100));
                }

                debugLog('Sending CHECK_SITE message');
                const response = await new Promise((resolve, reject) => {
                    chrome.tabs.sendMessage(matchedTab.id, {
                        type: "CHECK_SITE",
                        url: origin,
                        options: options
                    }, response => {
                        if (chrome.runtime.lastError) {
                            reject(chrome.runtime.lastError);
                        } else {
                            debugLog('Received check results:', response);
                            resolve(response);
                        }
                    });
                });

                if (response) {
                    // Get fresh copy of withExposedGit to avoid race conditions
                    const currentStorage = await chrome.storage.local.get(["withExposedGit"]);
                    const withExposedGit = currentStorage.withExposedGit || [];

                    // Process results and update storage
                    if (response.git) {
                        debugLog('Git repository found at:', origin);
                        // Check if this URL is already in the list
                        if (!withExposedGit.some(item => item.url === origin && item.type === "git")) {
                            withExposedGit.push({
                                type: "git",
                                url: origin,
                                open: response.opensource || false,
                                securitytxt: response.securitytxt
                            });
                            chrome.notifications.create({
                                type: "basic",
                                iconUrl: chrome.runtime.getURL("icons/dotgit-48.png"),
                                title: "Found an exposed .git",
                                message: `${origin}/.git/`
                            });
                        }
                    }
                    if (response.svn) {
                        if (!withExposedGit.some(item => item.url === origin && item.type === "svn")) {
                            withExposedGit.push({
                                type: "svn",
                                url: origin,
                                securitytxt: response.securitytxt
                            });
                            chrome.notifications.create({
                                type: "basic",
                                iconUrl: chrome.runtime.getURL("icons/dotgit-48.png"),
                                title: "Found an exposed .svn",
                                message: `${origin}/.svn/`
                            });
                        }
                    }
                    if (response.hg) {
                        if (!withExposedGit.some(item => item.url === origin && item.type === "hg")) {
                            withExposedGit.push({
                                type: "hg",
                                url: origin,
                                securitytxt: response.securitytxt
                            });
                            chrome.notifications.create({
                                type: "basic",
                                iconUrl: chrome.runtime.getURL("icons/dotgit-48.png"),
                                title: "Found an exposed .hg",
                                message: `${origin}/.hg/`
                            });
                        }
                    }
                    if (response.env) {
                        if (!withExposedGit.some(item => item.url === origin && item.type === "env")) {
                            withExposedGit.push({
                                type: "env",
                                url: origin,
                                securitytxt: response.securitytxt
                            });
                            chrome.notifications.create({
                                type: "basic",
                                iconUrl: chrome.runtime.getURL("icons/dotgit-48.png"),
                                title: "Found an exposed .env",
                                message: `${origin}/.env`
                            });
                        }
                    }
                    if (response.ds_store) {
                        if (!withExposedGit.some(item => item.url === origin && item.type === "ds_store")) {
                            withExposedGit.push({
                                type: "ds_store",
                                url: origin,
                                securitytxt: response.securitytxt
                            });
                            chrome.notifications.create({
                                type: "basic",
                                iconUrl: chrome.runtime.getURL("icons/dotgit-48.png"),
                                title: "Found an exposed .DS_Store",
                                message: `${origin}/.DS_Store`
                            });
                        }
                    }

                    if (withExposedGit.length !== currentStorage.withExposedGit.length) {
                        await chrome.storage.local.set({withExposedGit});
                        setBadge();
                    }
                }
            } catch (error) {
                console.error('[DotGit Background] Error:', error);
            }
        } else {
            debugLog('No matching tab found for:', origin);
        }
    } catch (error) {
        console.error('[DotGit Background] Error in processListener:', error);
    } finally {
        // Rimuovi l'URL da quelli in elaborazione, anche in caso di errore
        processingUrls.delete(origin);
    }
}


function checkBlacklist(hostname) {
    for (const b of blacklist) {
        let splits = b.split('*');
        if (splits[1] !== "undefined") {
            let parts = [];
            splits.forEach(el => parts.push(escapeRegExp(el)));
            let re = new RegExp(parts.join('.*'));
            if (re.test(hostname) === true) {
                return true;
            }
        }
    }
    return false;
}


function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}


function isValidUrl(string) {
    try {
        new URL(string);
    } catch (_) {
        return false;
    }
    return true;
}

