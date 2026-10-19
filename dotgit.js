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
let compiledBlacklist = [];
let processingUrls = new Set();
let debug = false;

// `checked` and `withExposedGit` are single arrays in storage. Several listeners
// can read-modify-write them at the same time (a page with many requests, several
// tabs, the popup answering messages), and the last write would silently drop the
// others. Every write goes through this promise chain instead.
let storageLock = Promise.resolve();

function withStorageLock(task) {
    const result = storageLock.then(task, task);
    storageLock = result.then(() => {}, () => {});
    return result;
}

async function isChecked(origin) {
    const {checked = []} = await chrome.storage.local.get(["checked"]);
    return checked.includes(origin);
}

async function markChecked(origin) {
    await withStorageLock(async () => {
        const {checked = []} = await chrome.storage.local.get(["checked"]);
        if (!checked.includes(origin)) {
            checked.push(origin);
            await chrome.storage.local.set({checked});
        }
    });
}

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
    const walkedPaths = new Set();

    let fileExist = false;
    let downloadStats = {};
    let failedInARow = 0;
    let downloadStatus = {
        successful: 0,
        failed: 0,
        total: 0
    };

    // FIFO queue + worker pool
    const queue = [];
    let active = 0;

    // Reference counting for termination detection
    let pendingCount = 0;
    let zipTriggered = false;

    function arrayBufferToString(buffer) {
        // Build a true latin-1 (1:1 byte->char) string. TextDecoder('iso-8859-1')
        // is an alias for windows-1252, which remaps bytes 0x80-0x9F to multi-byte
        // code points and corrupts raw SHA-1 bytes parsed by checkTree.
        const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
        let result = "";
        const chunkSize = 0x8000;
        for (let i = 0; i < bytes.length; i += chunkSize) {
            result += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
        }
        return result;
    }

    function downloadZip() {
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

    function tryTriggerZip() {
        if (pendingCount === 0 && !zipTriggered) {
            zipTriggered = true;
            downloadZip();
        }
    }


    function enqueue(path, decompress, callback) {
        if (walkedPaths.has(path)) {
            return;
        }
        if (failedInARow > failed_in_a_row) {
            return;
        }
        walkedPaths.add(path);
        pendingCount++;
        downloadStatus.total++;
        queue.push({path, decompress, callback});
        drain();
    }

    function drain() {
        while (active < max_connections && queue.length > 0) {
            const job = queue.shift();
            active++;
            processJob(job);
        }
    }

    function processJob({path, decompress, callback}) {
        fetch(baseUrl + GIT_PATH + path, {
            redirect: "manual"
        }).then(function (response) {
            downloadStats[response.status] = (typeof downloadStats[response.status] === "undefined") ? 1 : downloadStats[response.status] + 1;
            if (response.ok && response.status === 200) {
                fileExist = true;
                downloadStatus.successful++;
                failedInARow = 0;
                sendDownloadStatus(baseUrl, downloadStatus);
                return response.arrayBuffer();
            }
            downloadStatus.failed++;
            failedInARow++;
            sendDownloadStatus(baseUrl, downloadStatus);
        }).then(function (buffer) {
            if (typeof buffer !== "undefined") {
                downloadedFiles.push([path, buffer]);
                // noinspection JSCheckFunctionSignatures
                const words = new Uint8Array(buffer);

                if (decompress) {
                    try {
                        let data = pako.ungzip(words);
                        callback(arrayBufferToString(data));
                    } catch (e) {
                        // do nothing
                    }
                } else {
                    callback(arrayBufferToString(words));
                }
            }
        }).catch(function (error) {
            // Network error (offline, DNS, aborted...): no HTTP status to count.
            downloadStats.network_error = (downloadStats.network_error || 0) + 1;
            downloadStatus.failed++;
            failedInARow++;
            sendDownloadStatus(baseUrl, downloadStatus);
            debugLog('Download failed:', path, error);
        }).finally(function () {
            active--;
            pendingCount--;
            tryTriggerZip();
            drain();
        });
    }


    function checkTree(result) {
        if (!result.startsWith(GIT_TREE_HEADER)) return;

        // Skip "tree <size>\0" header
        let pos = result.indexOf(GIT_BLOB_DELIMITER);
        if (pos === -1) return;
        pos++;

        while (pos < result.length) {
            // Read mode (until space)
            const spaceIdx = result.indexOf(' ', pos);
            if (spaceIdx === -1) break;
            pos = spaceIdx + 1;

            // Read name (until \0)
            const nullIdx = result.indexOf(GIT_BLOB_DELIMITER, pos);
            if (nullIdx === -1) break;
            pos = nullIdx + 1;

            // Read exactly 20 bytes of SHA-1
            if (pos + SHA1_SIZE > result.length) break;
            let hash = "";
            for (let j = pos; j < pos + SHA1_SIZE; j++) {
                const chr = result.charCodeAt(j).toString(16);
                hash += chr.length < 2 ? "0" + chr : chr;
            }
            pos += SHA1_SIZE;

            const path = GIT_OBJECTS_PATH + hash.slice(0, 2) + "/" + hash.slice(2);
            enqueue(path, true, checkResult);
        }
    }


    function checkObject(result) {
        if (result.startsWith('commit ')) {
            // Parse commit object: only extract tree and parent hashes
            const headerEnd = result.indexOf(GIT_BLOB_DELIMITER);
            if (headerEnd === -1) return;
            const body = result.substring(headerEnd + 1);
            const lines = body.split('\n');
            for (const line of lines) {
                if (line === '') break;
                const match = line.match(/^(tree|parent) ([a-f0-9]{40})$/);
                if (match) {
                    const path = GIT_OBJECTS_PATH + match[2].slice(0, 2) + "/" + match[2].slice(2);
                    enqueue(path, true, checkResult);
                }
            }
        } else if (result.startsWith('blob ')) {
            // Skip blob objects to avoid false positive matches
            return;
        } else {
            // For other text-based content (packed-refs, logs, tags), parse line-by-line
            const lines = result.split('\n');
            const hashRegex = /[a-f0-9]{40}/g;
            for (const line of lines) {
                let match;
                while ((match = hashRegex.exec(line)) !== null) {
                    const path = GIT_OBJECTS_PATH + match[0].slice(0, 2) + "/" + match[0].slice(2);
                    enqueue(path, true, checkResult);
                }
                hashRegex.lastIndex = 0;
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
                enqueue(pathExt, false, function () {
                });
                enqueue(pathIdx, false, function () {
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
        enqueue(GIT_WELL_KNOW_PATHS[i], false, checkResult);
    }
}


function compileBlacklist(list) {
    return list.filter(function (b) {
        // Storage can be old or edited by hand: a non-string would throw here
        // (and take the whole worker down), an empty entry would match every host.
        return typeof b === "string" && b !== "";
    }).map(function (b) {
        const splits = b.split('*');
        const parts = splits.map(function (el) { return escapeRegExp(el); });
        return new RegExp(parts.join('.*'));
    });
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
    compiledBlacklist = compileBlacklist(blacklist);
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
        const data = msg.data;
        (async () => {
            try {
                const newFindings = await withStorageLock(async () => {
                    const result = await chrome.storage.local.get(["withExposedGit"]);
                    const withExposedGit = result.withExposedGit || [];
                    const origin = data.url;
                    const added = [];

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
                            added.push({type, findingUrl});
                        }
                    }

                    if (added.length > 0) {
                        await chrome.storage.local.set({withExposedGit});
                        await setBadge();
                    }

                    return added;
                });

                if (newFindings.length > 0) {
                    const title = newFindings.length === 1
                                  ? `Exposed ${newFindings[0].type} found!`
                                  : 'Multiple exposures found!';

                    const message = newFindings.length === 1
                                    ? `Found at: ${newFindings[0].findingUrl}`
                                    : newFindings.map(f => `${f.type}: ${f.findingUrl}`).join('\n');

                    notification(title, message);
                }

                sendResponse({status: true});
            } catch (error) {
                debugLog('Error processing findings:', error);
                sendResponse({status: false, error: error.message});
            }
        })();
        return true;
    } else if (msg.type === "download") {
        notification("Download status", "Download started\nPlease wait...");
        startDownload(msg.url, async (fileExist, downloadStats) => {
            let strStatus = Object.entries(downloadStats)
                .map(([key, value]) => `${key}: ${value}`)
                .join('\n');

            await withStorageLock(async () => {
                const downloading = await chrome.storage.local.get(["downloading"]);
                if (downloading.downloading?.length) {
                    const index = downloading.downloading.indexOf(msg.url);
                    if (index > -1) {
                        downloading.downloading.splice(index, 1);
                        await chrome.storage.local.set({downloading: downloading.downloading});
                    }
                }
            });

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
        (async () => {
            try {
                const shouldFetch = await withStorageLock(async () => {
                    const result = await chrome.storage.local.get(["options", "checked"]);
                    const options = result.options || DEFAULT_OPTIONS;
                    const checked = new Set(result.checked || []);

                    if (!options.functions.git || checked.has(origin)) {
                        return false;
                    }

                    checked.add(origin);
                    await chrome.storage.local.set({checked: [...checked]});
                    return true;
                });

                sendResponse({shouldFetch});
            } catch (error) {
                debugLog('Error in REQUEST_GIT_CHECK:', error);
                sendResponse({shouldFetch: false});
            }
        })();
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
        'blacklist': () => { blacklist = msg.value; compiledBlacklist = compileBlacklist(blacklist); }
    };

    if (optionHandlers[msg.type]) {
        optionHandlers[msg.type]();
        sendResponse({status: true});
        return false;
    }

    if (msg.type === "check_failed") {
        // The onErrorOccurred listener is always registered; processListener reads
        // this flag, so there is nothing to add or remove here.
        check_failed = msg.value;
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


// Register the network listeners synchronously, at worker start. They used to be
// registered inside the storage callback below, so the first navigation of a cold
// worker could finish before the listener existed and that site was never scanned.
chrome.webRequest.onCompleted.addListener(
    details => processListener(details),
    {urls: ["<all_urls>"]}
);

// Failed requests are only useful when the option is on, but the guard lives in
// processListener: registering the listener here keeps startup race-free.
chrome.webRequest.onErrorOccurred.addListener(
    details => processListener(details),
    {urls: ["<all_urls>"]}
);

chrome.webRequest.onHeadersReceived.addListener(
    details => processListener(details),
    {urls: ["<all_urls>"]}
);


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

function tabMatchesOrigin(tab, origin) {
    try {
        return !!tab.url && new URL(tab.url).origin === origin;
    } catch (e) {
        return false;
    }
}

// Return the tab this request belongs to once it really shows `origin`, or null.
// The tab URL is still the previous page when the main_frame request completes, so
// poll it instead of waiting for a tabs.onUpdated 'complete' event: that event is
// not delivered reliably (it can be missed entirely for the first navigation of a
// fresh profile) and waiting for it was what made scans silently disappear.
async function getScannableTab(details, origin, timeoutMs = 10000) {
    if (details.tabId < 0) {
        return null;
    }

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const tab = await chrome.tabs.get(details.tabId).catch(() => null);
        if (!tab) {
            return null;
        }
        if (tabMatchesOrigin(tab, origin)) {
            return tab;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return null;
}

async function processListener(details) {
    const url = new URL(details.url);
    const origin = url.origin;

    // Only web pages can be scanned (chrome-extension:, about:, data: ... cannot).
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        return;
    }

    if (!check_failed && (details.error || details.statusCode >= 400)) {
        return;
    }

    // Only document requests identify a site we can scan. Reacting to assets as
    // well used to write every CDN origin into `checked` without ever scanning it
    // (a subresource origin can never match its tab's origin) and leaked one
    // tabs.onUpdated listener per origin.
    if (details.type !== "main_frame") {
        return;
    }

    if (processingUrls.has(origin)) {
        return;
    }

    try {
        processingUrls.add(origin);

        if (checkBlacklist(new URL(origin).hostname)) {
            return;
        }

        if (await isChecked(origin)) {
            return;
        }

        const tab = await getScannableTab(details, origin);

        // Tab closed, navigated away, or never finished loading.
        if (!tab) {
            return;
        }

        const hasPermissions = await chrome.permissions.contains({
            origins: [origin + "/*"]
        });

        if (!hasPermissions && !(await requestPermissions())) {
            return;
        }

        const {options = DEFAULT_OPTIONS} =
            await chrome.storage.local.get(["options"]);

        const isContentScriptAvailable = await new Promise(resolve => {
            chrome.tabs.sendMessage(tab.id, {type: "PING"}, response => {
                resolve(!chrome.runtime.lastError);
            });
        });

        if (!isContentScriptAvailable) {
            await chrome.scripting.executeScript({
                target: {tabId: tab.id},
                files: ['content_script.js']
            });
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        await chrome.tabs.sendMessage(tab.id, {
            type: "CHECK_SITE",
            url: origin,
            options: options
        });

        // Remember the origin only once the scan was really dispatched: if the
        // tab disappeared or the content script could not be injected, the next
        // visit must try again instead of finding the site permanently "checked".
        await markChecked(origin);
    } catch (error) {
        debugLog('Error in processListener:', error);
    } finally {
        processingUrls.delete(origin);
    }
}


function checkBlacklist(hostname) {
    for (const re of compiledBlacklist) {
        if (re.test(hostname)) {
            return true;
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

