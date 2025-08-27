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
    "check_failed": true,
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

const EXTENSION_ICON = {
    "48": "icons/dotgit-48.png",
    "96": "icons/dotgit-96.png"
};

const GIT_PATH = "/.git/";
const SVN_PATH = "/.svn/";
const HG_PATH = "/.hg/";
const ENV_PATH = "/.env";
const DS_STORE = "/.DS_Store";

const GIT_TREE_HEADER = "tree ";
const GIT_OBJECTS_PATH = "objects/";
const GIT_OBJECTS_SEARCH = "[a-f0-9]{40}";
const GIT_PACK_PATH = "objects/pack/";
const GIT_PACK_SEARCH = "pack\-[a-f0-9]{40}";
const GIT_PACK_EXT = ".pack";
const GIT_IDX_EXT = ".idx";
const SHA1_SIZE = 20;
const GIT_BLOB_DELIMITER = String.fromCharCode(0);
const STATUS_DESCRIPTION = "HTTP Status code for downloaded files: 200 Good, 404 Normal, 403 and 5XX Bad\n";

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
let check_failed;
let blacklist = [];
let processingUrls = new Set();
let debug = false;

function debugLog(...args) {
    if (debug) {
        console.log('[DotGit Debug]', ...args);
    }
}
debugLog('Background script loaded');

// Firefox persistence mechanism for Manifest V3
let isWorkerActive = true;

// Keep worker alive with periodic activity
const keepAlive = setInterval(() => {
    if (!isWorkerActive) {
        clearInterval(keepAlive);
        return;
    }
    
    // Perform a minimal operation to keep the worker active
    chrome.storage.local.get(['lastActivity'], (result) => {
        chrome.storage.local.set({ lastActivity: Date.now() });
    });
}, 25000); // Every 25 seconds

// Handle extension lifecycle events
chrome.runtime.onStartup.addListener(() => {
    debugLog('Extension started');
    isWorkerActive = true;
});

chrome.runtime.onInstalled.addListener((details) => {
    debugLog('Extension installed/updated:', details.reason);
    isWorkerActive = true;
});

// Handle when Firefox suspends the worker
chrome.runtime.onSuspend.addListener(() => {
    debugLog('Service worker suspended');
    isWorkerActive = false;
});

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
        iconUrl: chrome.runtime.getURL(EXTENSION_ICON["48"]),
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

// it may happen that the badge is set at the same time by several checks. in this way it could be increased only once
async function setBadge() {
    try {
        const result = await chrome.storage.local.get(["withExposedGit"]);
        if (typeof chrome.action !== "undefined" && typeof chrome.action.setBadgeText !== "undefined") {
            const text = (result.withExposedGit || []).length.toString();
            await chrome.action.setBadgeText({text});
        }
    } catch (error) {
        debugLog('setBadge - Error:', error);
    }
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

                    // make an object path and download
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
                // make an object path and download
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
    check_failed = options.check_failed;
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


chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    debugLog('Received message:', msg.type);

    if (msg.type === "FINDINGS_FOUND") {
        chrome.storage.local.get(["withExposedGit"], async (result) => {
            try {
                let withExposedGit = result.withExposedGit || [];
                const data = msg.data;
                const origin = data.url;
                let updatedList = false;
                let newFindings = [];

                for (const type of data.types) {
                    const findingUrl = origin + (
                        type === 'git' ? GIT_PATH :
                        type === 'svn' ? SVN_PATH :
                        type === 'hg' ? HG_PATH :
                        type === 'env' ? ENV_PATH :
                        DS_STORE
                    );

                    if (!withExposedGit.some(item =>
                        item.url === origin && item.type === type
                    )) {
                        withExposedGit.push({
                            type: type,
                            url: origin,
                            open: data.opensource || false,
                            securitytxt: data.securitytxt || false,
                            foundAt: findingUrl
                        });
                        updatedList = true;
                        newFindings.push({type, findingUrl});
                    }
                }

                if (updatedList) {
                    await chrome.storage.local.set({withExposedGit});
                    await setBadge();

                    // Show a single notification with all findings
                    if (newFindings.length > 0) {
                        const title = newFindings.length === 1
                                      ? `Exposed ${newFindings[0].type} found!`
                                      : 'Multiple exposures found!';

                        const message = newFindings.length === 1
                                        ? `Found at: ${newFindings[0].findingUrl}`
                                        : newFindings.map(f => `${f.type}: ${f.findingUrl}`).join('\n');

                        chrome.notifications.create({
                            type: "basic",
                            iconUrl: chrome.runtime.getURL(EXTENSION_ICON["48"]),
                            title: title,
                            message: message
                        });
                    }
                }

                sendResponse({status: true});
            } catch (error) {
                debugLog('Error processing findings:', error);
                sendResponse({status: false, error: error.message});
            }
        });
        return true;
    } else if (msg.type === "download") {
        notification("Download status", "Download started\nPlease wait...");
        startDownload(msg.url, async (fileExist, downloadStats) => {
            let strStatus = Object.entries(downloadStats)
                .map(([key, value]) => `${key}: ${value}`)
                .join('\n');

            const downloading = await chrome.storage.local.get(["downloading"]);
            if (downloading.downloading?.length) {
                const index = downloading.downloading.indexOf(msg.url);
                if (index > -1) {
                    downloading.downloading.splice(index, 1);
                    await chrome.storage.local.set({downloading: downloading.downloading});
                }
            }

            notification("Download status",
                fileExist
                ? `Downloaded ${msg.url}\n${strStatus}`
                : `Failed to download ${msg.url}\nNo files found\n${strStatus}`
            );
            sendResponse({status: fileExist});
        });
        return true;
    } else if (msg.type === "REQUEST_GIT_CHECK") {
        const {origin} = msg;
        chrome.storage.local.get(["options", "checked"], async (result) => {
            const options = result.options || DEFAULT_OPTIONS;
            const alreadyChecked = result.checked || [];

            if (!options.functions.git || alreadyChecked.includes(origin)) {
                sendResponse({shouldFetch: false});
                return;
            }

            alreadyChecked.push(origin);
            await chrome.storage.local.set({checked: alreadyChecked});
            sendResponse({shouldFetch: true});
        });
        return true;
    }

    // Handle simple option updates
    const optionHandlers = {
        'git': () => check_git = msg.value,
        'svn': () => check_svn = msg.value,
        'hg': () => check_hg = msg.value,
        'env': () => check_env = msg.value,
        'ds_store': () => check_ds_store = msg.value,
        'notification_new_git': () => notification_new_git = msg.value,
        'notification_download': () => notification_download = msg.value,
        'check_opensource': () => check_opensource = msg.value,
        'check_securitytxt': () => check_securitytxt = msg.value,
        'debug': () => debug = msg.value,
        'max_connections': () => max_connections = msg.value,
        'wait': () => wait = msg.value,
        'max_wait': () => max_wait = msg.value,
        'failed_in_a_row': () => failed_in_a_row = msg.value,
        'blacklist': () => blacklist = msg.value
    };

    if (optionHandlers[msg.type]) {
        optionHandlers[msg.type]();
        sendResponse({status: true});
        return false;
    }

    if (msg.type === "check_failed") {
        check_failed = msg.value;
        try {
            chrome.webRequest.onErrorOccurred.removeListener(processListener);
        } catch (e) {
            // Ignore if listener doesn't exist
        }
        if (msg.value) {
            chrome.webRequest.onErrorOccurred.addListener(
                processListener,
                {urls: ["<all_urls>"]}
            );
        }
        sendResponse({status: true});
        return false;
    }

    if (msg.type === "reset_options") {
        chrome.storage.local.set({options: DEFAULT_OPTIONS});
        set_options(DEFAULT_OPTIONS);
        sendResponse({status: true, options: DEFAULT_OPTIONS});
        return false;
    }

    return false;
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

    // Add listener for completed requests
    chrome.webRequest.onCompleted.addListener(
        details => processListener(details),
        {urls: ["<all_urls>"]}
    );

    // Add listener for error requests to catch failed attempts only if enabled
    if (check_failed) {
        chrome.webRequest.onErrorOccurred.addListener(
            details => processListener(details),
            {urls: ["<all_urls>"]}
        );
    }

    // Keep the existing headers listener
    chrome.webRequest.onHeadersReceived.addListener(
        details => processListener(details),
        {urls: ["<all_urls>"]}
    );
});

// Reset download status at each start
chrome.storage.local.set({
    downloading: []
});


async function requestPermissions() {
    try {
        const granted = await chrome.permissions.request({
            origins: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"]
        });
        debugLog('Permission request result:', granted);
        return granted;
    } catch (error) {
        debugLog('Error requesting permissions:', error);
        return false;
    }
}

async function processListener(details) {
    const origin = new URL(details.url).origin;

    if (!check_failed && (details.error || details.statusCode >= 400)) {
        return;
    }

    if (processingUrls.has(origin)) {
        return;
    }

    try {
        processingUrls.add(origin);

        const hasPermissions = await chrome.permissions.contains({
            origins: [origin + "/*"]
        });

        if (!hasPermissions && !(await requestPermissions())) {
            return;
        }

        const result = await chrome.storage.local.get(["checked", "options"]);
        const options = result.options || DEFAULT_OPTIONS;
        const alreadyChecked = result.checked || [];

        if (alreadyChecked.includes(origin) || checkBlacklist(new URL(origin).hostname)) {
            return;
        }

        alreadyChecked.push(origin);
        await chrome.storage.local.set({checked: alreadyChecked});

        // Wait for the tab to be fully loaded
        const tabReady = await new Promise((resolve) => {
            const listener = (tabId, changeInfo, tab) => {
                try {
                    const tabOrigin = new URL(tab.url).origin;
                    if (tabOrigin === origin && changeInfo.status === 'complete') {
                        chrome.tabs.onUpdated.removeListener(listener);
                        resolve(tab);
                    }
                } catch (e) {
                    // Invalid URL, ignore
                }
            };

            chrome.tabs.onUpdated.addListener(listener);
        });

        if (!tabReady) {
            return;
        }

        const isContentScriptAvailable = await new Promise(resolve => {
            chrome.tabs.sendMessage(tabReady.id, {type: "PING"}, response => {
                resolve(!chrome.runtime.lastError);
            });
        });

        if (!isContentScriptAvailable) {
            await chrome.scripting.executeScript({
                target: {tabId: tabReady.id},
                files: ['content_script.js']
            });
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        await chrome.tabs.sendMessage(tabReady.id, {
            type: "CHECK_SITE",
            url: origin,
            options: options
        });
    } catch (error) {
        debugLog('Error in processListener:', error);
    } finally {
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

// Add listener for installation
chrome.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === 'install' || details.reason === 'update') {
        debugLog('Extension installed/updated');

        await chrome.storage.local.set({
            checked: [],
            withExposedGit: [],
            downloading: [],
            options: DEFAULT_OPTIONS
        });

        const hasPermissions = await chrome.permissions.contains({
            origins: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"]
        });

        if (!hasPermissions) {
            notification("Welcome to DotGit!", "Click the extension icon to get started. You'll need to grant permissions to check for exposed Git repositories.");
        }
    }
});

// Modify storage change listener to be more concise
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.withExposedGit) {
        debugLog('Storage updated - new findings count:',
            changes.withExposedGit.newValue ? changes.withExposedGit.newValue.length : 0
        );
    }
});

