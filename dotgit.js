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
    // Seconds before a network request (detection, download, open-source probe)
    // is aborted. One value for every check, so a slow connection is configured
    // in one place.
    "request_timeout": 15,
    "notification": {
        "new_git": true,
        "download": true
    },
    "check_opensource": true,
    "check_securitytxt": true,
    "debug": false,
    "check_failed": true,
    "download": {
        "max_connections": 20,
        "failed_in_a_row": 250
    },
    "blacklist": [
        'localhost'
    ]
};

const HOST_PERMISSIONS = ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"];

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

let max_connections;
let request_timeout = 15;
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
// One permission notification per browser session: the worker starts again on
// every navigation, so without this the user would be notified continuously.
let permissionsNotified = false;
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

// `checked` and `withExposedGit` are the only state that grows while browsing.
// Storage has no useful per-key quota, so keep them finite: the cap is far
// above any real profile (100k origins), and the oldest entries go first.
const MAX_STORED_ENTRIES = 100000;

function capList(list) {
    return list.length > MAX_STORED_ENTRIES
        ? list.slice(list.length - MAX_STORED_ENTRIES)
        : list;
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
            await chrome.storage.local.set({checked: capList(checked)});
        }
    });
}

function debugLog(...args) {
    if (debug) {
        console.log('[DotGit Debug]', ...args);
    }
}
debugLog('Background script loaded');

// Firefox starts the event page at browser startup so the top-level webRequest
// listeners below are registered (and persisted) again for the new session.
chrome.runtime.onStartup.addListener(() => {
    debugLog('Extension started');
    void checkPermissionsOnStart();
});

chrome.runtime.onSuspend.addListener(() => {
    debugLog('Service worker suspended');
});

function notification(title, message) {
    const enabled = title === "Download status" ? notification_download : notification_new_git;
    if (!enabled) {
        return;
    }

    // The notification is a side effect: if a browser build lacks the API (and
    // Firefox for Android lacks several), the finding that was just stored must
    // not turn into an error response.
    if (typeof chrome.notifications === "undefined") {
        return;
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
            const count = (result.withExposedGit || []).length;
            // No findings means no badge: "0" is a number shown on the icon.
            await chrome.action.setBadgeText({text: count > 0 ? String(count) : ""});
        }
    } catch (error) {
        debugLog('setBadge - Error:', error);
    }
}


function startDownload(baseUrl, downloadFinished) {
    const downloadedFiles = [];
    const walkedPaths = new Set();

    // A hostile server can answer every object hash with another valid tree, so
    // the walk has no natural end. These limits sit far above any real .git
    // dump: when one is reached the crawl stops and the zip keeps what was
    // already fetched, with `truncated: 1` in its stats.
    const MAX_DOWNLOAD_FILES = 200000;
    const MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024;
    let downloadedBytes = 0;

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
                if (chrome.downloads && chrome.downloads.download) {
                    chrome.downloads.download({
                        url: URL.createObjectURL(zipBlob),
                        filename: `${filename}.zip`
                    });
                }
                downloadFinished(fileExist, downloadStats);
            });
        } else {
            // Chrome download
            zip.generateAsync({type: "base64"}).then(function (zipData) {
                if (chrome.downloads && chrome.downloads.download) {
                    chrome.downloads.download({
                        url: `data:application/octet-stream;base64,${zipData}`,
                        filename: `${filename}.zip`
                    });
                }
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
        if (walkedPaths.size >= MAX_DOWNLOAD_FILES || downloadedBytes >= MAX_DOWNLOAD_BYTES) {
            downloadStats.truncated = 1;
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
        // A server that accepts the connection and never answers used to keep the
        // whole download (and the popup button) open forever.
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), requestTimeoutMs());
        fetch(baseUrl + GIT_PATH + path, {signal: controller.signal}).then(function (response) {
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
                downloadedBytes += buffer.byteLength;
                // noinspection JSCheckFunctionSignatures
                const words = new Uint8Array(buffer);

                if (decompress) {
                    try {
                        let data = pako.ungzip(words);
                        callback(arrayBufferToString(data));
                    } catch (e) {
                        // do nothing
                    }
                } else if (callback) {
                    // Packs and indexes are stored as they are: building a string
                    // for a no-op callback doubled the memory of the largest file.
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
            // Covers the body too: the abort must stay armed until arrayBuffer()
            // has settled.
            clearTimeout(timer);
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

            enqueue(GIT_PACK_PATH + matches[0] + GIT_PACK_EXT, false, null);
            enqueue(GIT_PACK_PATH + matches[0] + GIT_IDX_EXT, false, null);
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

// The option stores seconds. set_options and the option message clamp it to
// 5..300, so a stale or hand-edited value can no longer make a request abort
// at once or wait forever.
function requestTimeoutMs() {
    return request_timeout * 1000;
}

function set_options(options) {
    max_connections = clampInt(options.download.max_connections, 20, 1, 1000);
    request_timeout = clampInt(options.request_timeout, 15, 5, 300);
    failed_in_a_row = clampInt(options.download.failed_in_a_row, 250, 1, 1000000);
    notification_new_git = Boolean(options.notification.new_git);
    notification_download = Boolean(options.notification.download);
    check_opensource = Boolean(options.check_opensource);
    check_securitytxt = Boolean(options.check_securitytxt);
    check_git = Boolean(options.functions.git);
    check_svn = Boolean(options.functions.svn);
    check_hg = Boolean(options.functions.hg);
    check_env = Boolean(options.functions.env);
    check_ds_store = Boolean(options.functions.ds_store);
    debug = Boolean(options.debug);
    check_failed = Boolean(options.check_failed);
    blacklist = options.blacklist;
    compiledBlacklist = compileBlacklist(blacklist);
}


function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}


// Storage is editable by hand and the options page can send any number: a NaN
// or a zero would silently stop the download (0 connections) or remove its
// limits (NaN never exceeds `failed_in_a_row`).
function clampInt(value, fallback, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
        return fallback;
    }
    return Math.min(Math.max(Math.trunc(number), min), max);
}


// Messages carry URLs that end up in storage and in the popup as hrefs. Only
// plain http(s) survives, whatever an old version or a hand edit left behind.
function normalizeOrigin(value) {
    try {
        const url = new URL(String(value));
        return url.protocol === "http:" || url.protocol === "https:" ? url.origin : false;
    } catch (error) {
        return false;
    }
}

function normalizeHttpUrl(value) {
    try {
        const url = new URL(String(value));
        return url.protocol === "http:" || url.protocol === "https:" ? url.href : false;
    } catch (error) {
        return false;
    }
}

const FINDING_TYPES = new Set(["git", "svn", "hg", "env", "ds_store"]);


function checkOptions(default_options, storage_options) {
    // Storage can be missing, null or contain a value of the wrong type (old
    // versions, manual edits): rebuild that branch from the defaults instead of
    // throwing on it.
    if (!isPlainObject(storage_options)) {
        storage_options = {};
    }
    for (const [key, defaultValue] of Object.entries(default_options)) {
        const value = storage_options[key];
        if (isPlainObject(defaultValue)) {
            storage_options[key] = checkOptions(defaultValue, value);
        } else if (Array.isArray(defaultValue)) {
            if (!Array.isArray(value)) {
                storage_options[key] = defaultValue.slice();
            }
        } else if (typeof value === "undefined") {
            storage_options[key] = defaultValue;
        }
    }
    return storage_options;
}

// True when stored options miss a key that the defaults define. A missing key is
// not the same as a disabled one (undefined is falsy), so the merged object is
// only persisted when something was really absent.
function needsOptionsDefaults(default_options, storage_options) {
    if (!isPlainObject(storage_options)) {
        return true;
    }
    for (const [key, defaultValue] of Object.entries(default_options)) {
        const value = storage_options[key];
        if (typeof value === "undefined") {
            return true;
        }
        if (isPlainObject(defaultValue)) {
            if (!isPlainObject(value) || needsOptionsDefaults(defaultValue, value)) {
                return true;
            }
        } else if (Array.isArray(defaultValue) && !Array.isArray(value)) {
            return true;
        }
    }
    return false;
}


// The content script cannot fetch github/gitlab (the page CORS applies), while
// the background can thanks to the host permissions. Only the two repository
// hosts are probed, so a crafted .git/config cannot make the extension request
// an arbitrary (internal) address; the abort keeps a silent host from stalling.
async function isReachableRepository(url) {
    let timer;
    try {
        const target = new URL(url);
        // owner/repo, not a user, an org or a feature page: those answer 200 too.
        const segments = target.pathname.split("/").filter(Boolean);
        const allowed = (target.hostname === "github.com" || target.hostname === "gitlab.com") &&
            (target.protocol === "https:" || target.protocol === "http:") &&
            segments.length >= 2;
        if (!allowed) {
            return false;
        }
        const controller = new AbortController();
        timer = setTimeout(() => controller.abort(), requestTimeoutMs());
        const response = await fetch(target.href, {signal: controller.signal});
        return response.status === 200;
    } catch (error) {
        debugLog('Open source check failed:', error);
        return false;
    } finally {
        clearTimeout(timer);
    }
}


chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    debugLog('Received message:', msg.type);

    if (msg.type === "FINDINGS_FOUND") {
        const data = msg.data || {};
        const origin = normalizeOrigin(data.url);
        const types = Array.isArray(data.types) ? data.types.filter((type) => FINDING_TYPES.has(type)) : [];
        const opensource = normalizeHttpUrl(data.opensource);
        const securitytxt = normalizeHttpUrl(data.securitytxt);

        if (!origin || types.length === 0) {
            debugLog('Ignoring a malformed findings message:', data);
            sendResponse({status: false});
            return false;
        }

        (async () => {
            try {
                const newFindings = await withStorageLock(async () => {
                    const result = await chrome.storage.local.get(["withExposedGit"]);
                    const withExposedGit = result.withExposedGit || [];
                    const added = [];

                    for (const type of types) {
                        const findingUrl = origin + (
                            type === 'git' ? GIT_PATH :
                            type === 'svn' ? SVN_PATH :
                            type === 'hg' ? HG_PATH :
                            type === 'env' ? ENV_PATH :
                            DS_STORE
                        );

                        if (!withExposedGit.some(item =>
                            item && item.type === type && item.url === origin
                        )) {
                            withExposedGit.push({
                                type: type,
                                url: origin,
                                open: opensource,
                                securitytxt: securitytxt,
                                foundAt: findingUrl
                            });
                            added.push({type, findingUrl});
                        }
                    }

                    if (added.length > 0) {
                        await chrome.storage.local.set({withExposedGit: capList(withExposedGit)});
                        await setBadge();
                    }

                    return added;
                });

                if (newFindings.length > 0) {
                    const labels = {
                        git: 'git repository',
                        svn: 'svn repository',
                        hg: 'hg repository',
                        env: '.env file',
                        ds_store: '.DS_Store file'
                    };
                    const label = (type) => labels[type] || type;

                    const title = newFindings.length === 1
                                  ? `Exposed ${label(newFindings[0].type)} found!`
                                  : `${newFindings.length} exposures found!`;

                    const message = newFindings.length === 1
                                    ? `Found at: ${newFindings[0].findingUrl}`
                                    : newFindings
                                        .map(f => `${label(f.type)}: ${f.findingUrl}`)
                                        .join('\n');

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
        const url = normalizeOrigin(msg.url);
        if (!url) {
            sendResponse({status: false});
            return false;
        }
        (async () => {
            try {
                // Registered here, before the download starts: the popup used to
                // write it after sending the message, so a download that failed at
                // once was removed from the list before that write landed and the
                // button stayed disabled until the next worker start.
                await withStorageLock(async () => {
                    const {downloading = []} = await chrome.storage.local.get(["downloading"]);
                    if (!downloading.includes(url)) {
                        downloading.push(url);
                        await chrome.storage.local.set({downloading});
                    }
                });
                notification("Download status", "Download started\nPlease wait...");
                startDownload(url, async (fileExist, downloadStats) => {
                    let strStatus = Object.entries(downloadStats)
                        .map(([key, value]) => `${key}: ${value}`)
                        .join('\n');

                    await withStorageLock(async () => {
                        const {downloading = []} = await chrome.storage.local.get(["downloading"]);
                        const index = downloading.indexOf(url);
                        if (index > -1) {
                            downloading.splice(index, 1);
                            await chrome.storage.local.set({downloading});
                        }
                    });

                    notification("Download status",
                        fileExist
                        ? `Downloaded ${url}\n${strStatus}`
                        : `Failed to download ${url}\nNo files found\n${strStatus}`
                    );
                    sendResponse({status: fileExist});
                });
            } catch (error) {
                debugLog('Error starting a download:', error);
                sendResponse({status: false});
            }
        })();
        return true;
    } else if (msg.type === "CHECK_OPEN_SOURCE") {
        isReachableRepository(msg.url).then((open) => sendResponse({open}));
        return true;
    } else if (msg.type === "DELETE_FINDING") {
        // The popup used to read, splice and write the list itself: a finding
        // stored by the scanner in that gap was overwritten. One writer only.
        const origin = normalizeOrigin(msg.url);
        const findingType = String(msg.findingType);
        (async () => {
            try {
                const removed = await withStorageLock(async () => {
                    const {withExposedGit = []} = await chrome.storage.local.get(["withExposedGit"]);
                    const index = withExposedGit.findIndex((item) =>
                        item && item.type === findingType && normalizeOrigin(item.url) === origin);
                    if (index === -1) {
                        return false;
                    }
                    withExposedGit.splice(index, 1);
                    await chrome.storage.local.set({withExposedGit});
                    return true;
                });
                await setBadge();
                const {withExposedGit = []} = await chrome.storage.local.get(["withExposedGit"]);
                sendResponse({status: true, removed, remaining: withExposedGit.length});
            } catch (error) {
                debugLog('Error deleting a finding:', error);
                sendResponse({status: false, removed: false});
            }
        })();
        return true;
    } else if (msg.type === "RESET_STATE") {
        // Same reason as DELETE_FINDING: the reset must not race a new finding.
        (async () => {
            try {
                await withStorageLock(() => chrome.storage.local.set({
                    checked: [],
                    withExposedGit: [],
                    downloading: []
                }));
                await setBadge();
                sendResponse({status: true});
            } catch (error) {
                debugLog('Error resetting the state:', error);
                sendResponse({status: false});
            }
        })();
        return true;
    }

    // Handle simple option updates
    const optionHandlers = {
        'git': () => check_git = Boolean(msg.value),
        'svn': () => check_svn = Boolean(msg.value),
        'hg': () => check_hg = Boolean(msg.value),
        'env': () => check_env = Boolean(msg.value),
        'ds_store': () => check_ds_store = Boolean(msg.value),
        'notification_new_git': () => notification_new_git = Boolean(msg.value),
        'notification_download': () => notification_download = Boolean(msg.value),
        'check_opensource': () => check_opensource = Boolean(msg.value),
        'check_securitytxt': () => check_securitytxt = Boolean(msg.value),
        'debug': () => debug = Boolean(msg.value),
        'max_connections': () => max_connections = clampInt(msg.value, max_connections, 1, 1000),
        'request_timeout': () => request_timeout = clampInt(msg.value, request_timeout, 5, 300),
        'failed_in_a_row': () => failed_in_a_row = clampInt(msg.value, failed_in_a_row, 1, 1000000),
        'blacklist': () => {
            blacklist = Array.isArray(msg.value) ? msg.value : [];
            compiledBlacklist = compileBlacklist(blacklist);
        }
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


// Bring the persisted state in line with this version. Kept as a named function
// so the migration can be exercised directly in tests.
function initStorage(result) {
    // Tolerate missing or corrupted keys: this can be an upgrade from a much
    // older version, or storage edited by hand.
    const checked = Array.isArray(result.checked) ? result.checked : [];
    const withExposedGit = Array.isArray(result.withExposedGit) ? result.withExposedGit : [];
    const storedOptions = isPlainObject(result.options) ? result.options : null;

    // A missing list is not written back: the read that produced `result`
    // happens while the worker boots, and the write would land a moment later,
    // possibly after the scanner had already stored a finding (which it then
    // wiped). Every reader already treats a missing list as empty.
    if (result.checked !== undefined && !Array.isArray(result.checked)) {
        chrome.storage.local.set({checked: checked});
    }
    if (result.withExposedGit !== undefined && !Array.isArray(result.withExposedGit)) {
        chrome.storage.local.set({withExposedGit: withExposedGit});
    }
    if (!storedOptions) {
        chrome.storage.local.set({options: DEFAULT_OPTIONS});
    }

    const options = storedOptions || DEFAULT_OPTIONS;

    // Write the merged options back only when keys were really missing: on
    // update onInstalled resets them, and an unconditional write here used to
    // restore the old values after the reset. Computed before the migration,
    // which repairs `functions` in memory and may make the object look complete.
    const optionsWereIncomplete = needsOptionsDefaults(DEFAULT_OPTIONS, options);

    // upgrade 3.7.4 => 4.0: options had no `functions` and every finding was a
    // bare URL string. Only wrap the strings, so a mixed list is not wrapped
    // twice.
    if (!isPlainObject(options.functions) || withExposedGit.some((entry) => typeof entry === "string")) {
        options.functions = checkOptions(DEFAULT_OPTIONS.functions, options.functions);
        const migrated = withExposedGit.map((entry) =>
            typeof entry === "string" ? {type: "git", url: entry} : entry);
        chrome.storage.local.set({withExposedGit: migrated});
    }

    const mergedOptions = checkOptions(DEFAULT_OPTIONS, options);
    if (optionsWereIncomplete) {
        chrome.storage.local.set({options: mergedOptions});
    }
    set_options(mergedOptions);

    // Permissions can be missing on any start (an update that asks for new
    // ones, a user who withheld them): check again and tell the user.
    void checkPermissionsOnStart();
}


chrome.storage.local.get(["checked", "withExposedGit", "options"], initStorage);

// Reset download status at each start
chrome.storage.local.set({
    downloading: []
});


async function requestPermissions() {
    try {
        const granted = await chrome.permissions.request({
            origins: HOST_PERMISSIONS
        });
        debugLog('Permission request result:', granted);
        return granted;
    } catch (error) {
        debugLog('Error requesting permissions:', error);
        return false;
    }
}

// Host permissions can be missing after an update (Firefox asks again for new
// ones) or because the user withheld them. Without them no check can run.
async function hasHostPermissions() {
    try {
        return await chrome.permissions.contains({
            origins: HOST_PERMISSIONS
        });
    } catch (error) {
        debugLog('Error checking permissions:', error);
        return false;
    }
}

// A permission request must come from a user gesture, so the background can
// only point at the popup, which has the request button. Notify once per
// browser session: the worker restarts on every navigation.
async function notifyMissingPermissions(title, message) {
    if (permissionsNotified) {
        return;
    }
    permissionsNotified = true;
    try {
        const stored = await chrome.storage.session.get("permissionsNotified");
        if (stored.permissionsNotified) {
            return;
        }
        await chrome.storage.session.set({permissionsNotified: true});
    } catch (error) {
        // storage.session is not available in every browser: the module flag
        // above still avoids a notification per page in this worker.
    }
    notification(title, message);
}

async function checkPermissionsOnStart() {
    try {
        if (await hasHostPermissions()) {
            return;
        }
        await notifyMissingPermissions("DotGit needs permissions",
            "Click the extension icon and grant access so DotGit can check for exposed Git repositories.");
    } catch (error) {
        debugLog('Error checking permissions on start:', error);
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
    let url;
    try {
        url = new URL(details.url);
    } catch (error) {
        debugLog('Could not parse a request URL:', details.url, error);
        return;
    }
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

        // Only the top frame runs the checks: content_script.js is registered in
        // all frames, and an unrestricted sendMessage made every iframe repeat
        // the same requests (one full set per frame).
        const isContentScriptAvailable = await new Promise(resolve => {
            chrome.tabs.sendMessage(tab.id, {type: "PING"}, {frameId: 0}, response => {
                resolve(!chrome.runtime.lastError);
            });
        });

        if (!isContentScriptAvailable) {
            await chrome.scripting.executeScript({
                target: {tabId: tab.id, frameIds: [0]},
                files: ['content_script.js']
            });
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        chrome.tabs.sendMessage(tab.id, {
            type: "CHECK_SITE",
            url: origin,
            options: options
        }, {frameId: 0}).catch((error) => {
            debugLog('Could not start the scan:', error);
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
    // Only a fresh installation starts from an empty state. Updates keep the
    // findings and the settings: resetting them on every release was a leftover
    // of an old schema migration.
    if (details.reason === 'install') {
        debugLog('Extension installed');

        await chrome.storage.local.set({
            checked: [],
            withExposedGit: [],
            downloading: [],
            options: DEFAULT_OPTIONS
        });
        // Keep the in-memory copy consistent with the reset storage.
        set_options(DEFAULT_OPTIONS);
    }

    // An update can add host permissions (Firefox asks for the new ones) or the
    // user may have withheld them: without a check, scanning would silently do
    // nothing. Asking for a permission needs a user gesture, so point at the
    // popup, which has the request button, instead of failing in the background.
    if (!(await hasHostPermissions())) {
        if (details.reason === 'install') {
            await notifyMissingPermissions("Welcome to DotGit!", "Click the extension icon to get started. You'll need to grant permissions to check for exposed Git repositories.");
        } else {
            await notifyMissingPermissions("DotGit needs permissions", "Click the extension icon and grant access so DotGit can check for exposed Git repositories.");
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

