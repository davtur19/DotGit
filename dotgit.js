import "/lib/jszip.min.js";
import "/lib/pako_inflate.min.js";

const DEFAULT_OPTIONS = {
    "functions": {
        "git": true,
        "svn": false,
        "hg": false,
        "env": false,
        "ds_store": true
    },
    "color": "grey",
    "max_sites": 100,
    "notification": {
        "new_git": true,
        "download": true
    },
    "check_opensource": true,
    "check_securitytxt": true,
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
const DS_STORE_HEADER = "\x00@\x00";

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
let queue_listener = new Queue();
let queue_req = new Queue();
let queue_running = false;
let blacklist = [];


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

async function checkDSStore(url) {
    const to_check = url + DS_STORE;

    try {
        const response = await fetchWithTimeout(to_check, {
            redirect: "manual",
            timeout: 10000
        });

        if (response.status === 200) {
            let text = await response.text();
            console.log(response.text());
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

            zip.generateAsync({type: "base64"}).then(function (zipData) {
                // download zip
                chrome.downloads.download({url: `data:application/octet-stream;base64,${zipData}`, filename: `${filename}.zip`});
                downloadFinished(fileExist, downloadStats);
            });
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
                headers: { "Accept": "text/html" },
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


chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    if (request.type === "download") {
        notification("Download status", "Download started\nPlease wait...");

        startDownload(request.url, function (fileExist, downloadStats) {
            let strStatus = "";

            chrome.storage.local.get(["downloading"], function (downloading) {
                if (typeof downloading.downloading !== "undefined" && downloading.downloading.length !== 0) {
                    let index = downloading.downloading.indexOf(request.url);
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
                notification("Download status", "Downloaded " + request.url + "\n" + strStatus);
                sendResponse({status: true});
            } else {
                notification("Download status", "Failed to download " + request.url + "\nNo files found\n" + strStatus);
                sendResponse({status: false});
            }
        });
    } else if (request.type === "git") {
        check_git = request.value;
        sendResponse({status: true});
    } else if (request.type === "svn") {
        check_svn = request.value;
        sendResponse({status: true});
    } else if (request.type === "ds_store") {
        check_ds_store = request.value;
    }  else if (request.type === "hg") {
        check_hg = request.value;
        sendResponse({status: true});
    } else if (request.type === "env") {
        check_env = request.value;
        sendResponse({status: true});
    } else if (request.type === "notification_new_git") {
        notification_new_git = request.value;
        sendResponse({status: true});
    } else if (request.type === "notification_download") {
        notification_download = request.value;
        sendResponse({status: true});
    } else if (request.type === "check_opensource") {
        check_opensource = request.value;
        sendResponse({status: true});
    } else if (request.type === "check_securitytxt") {
        check_securitytxt = request.value;
        sendResponse({status: true});
    } else if (request.type === "blacklist") {
        blacklist = request.value;
        sendResponse({status: true});
    } else if (request.type === "max_connections") {
        max_connections = request.value;
        sendResponse({status: true});
    } else if (request.type === "wait") {
        wait = request.value;
        sendResponse({status: true});
    } else if (request.type === "max_wait") {
        max_wait = request.value;
        sendResponse({status: true});
    } else if (request.type === "failed_in_a_row") {
        failed_in_a_row = request.value;
        sendResponse({status: true});
    } else if (request.type === "reset_options") {
        chrome.storage.local.set({options: DEFAULT_OPTIONS});
        set_options(DEFAULT_OPTIONS);
        sendResponse({status: true, options: DEFAULT_OPTIONS});
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


function processListener(details) {
    let origin = new URL(details["url"])["origin"];
    if (queue_req.isEmpty() === true) {
        chrome.storage.local.get(["checked", "withExposedGit"], result => processSearch(result, origin));
    } else {
        queue_listener.enqueue(origin);
    }
}


function checkUrl(storage, origin) {
    let hostname = new URL(origin)["hostname"];

    if (origin.startsWith("chrome-extension")) {
        return false;
    }
    return (storage.checked.includes(origin) === false && checkBlacklist(hostname) === false);
}


async function processSearch(storage, origin) {
    if (checkUrl(storage, origin)) {
        if (queue_running === false) {
            queue_running = true;
            queue_req.enqueue(origin);
            while (queue_listener.isEmpty() === false) {
                let origin2 = queue_listener.dequeue();
                if (checkUrl(storage, origin2)) {
                    queue_req.enqueue(origin2);
                }
            }
            await precessQueue(storage);
            queue_running = false;
        } else {
            queue_listener.enqueue(origin);
        }
    }
}


function Queue() {
    let collection = [];
    this.print = function () {
        console.log(collection);
    };
    this.enqueue = function (element) {
        // works for strings not objects
        if (collection.indexOf(element) === -1) {
            collection.push(element);
        }
    };
    this.dequeue = function () {
        return collection.shift();
    };
    this.front = function () {
        return collection[0];
    };
    this.size = function () {
        return collection.length;
    };
    this.isEmpty = function () {
        return (collection.length === 0);
    };
}


async function precessQueue(visitedSite) {
    while (queue_req.isEmpty() !== true) {
        let url = queue_req.front();
        let securitytxt = null;
        // replace ws and wss with http and https
        url = url.replace(WS_SEARCH, WS_REPLACE);

        if (check_git) {
            if (await checkGit(url) !== false) {
                let open = false;
                if (check_opensource) {
                    open = await isOpenSource(url);
                }
                if (check_securitytxt) {
                    securitytxt = await checkSecuritytxt(url);
                }

                visitedSite.withExposedGit.push({
                    type: "git",
                    url: url,
                    open: open,
                    securitytxt: securitytxt
                });
                chrome.storage.local.set(visitedSite);
            }
        }
        if (check_svn) {
            if (await checkSvn(url) !== false) {
                if (check_securitytxt && securitytxt === null) {
                    securitytxt = await checkSecuritytxt(url);
                }
                visitedSite.withExposedGit.push({type: "svn", url: url, securitytxt: securitytxt});
                chrome.storage.local.set(visitedSite);
            }
        }

        if (check_ds_store) {
            if (await checkDSStore(url) !== false ) {
                if (check_securitytxt && securitytxt === null ) {
                    securitytxt = await checkSecuritytxt(url);
                }
                visitedSite.withExposedGit.push({type: "ds_store", url: url, securitytxt: securitytxt});
                chrome.storage.local.set(visitedSite);
            }
        }

        if (check_hg) {
            if (await checkHg(url) !== false) {
                if (check_securitytxt && securitytxt === null) {
                    securitytxt = await checkSecuritytxt(url);
                }
                visitedSite.withExposedGit.push({type: "hg", url: url, securitytxt: securitytxt});
                chrome.storage.local.set(visitedSite);
            }
        }
        if (check_env) {
            if (await checkEnv(url) !== false) {
                if (check_securitytxt && securitytxt === null) {
                    securitytxt = await checkSecuritytxt(url);
                }
                visitedSite.withExposedGit.push({type: "env", url: url, securitytxt: securitytxt});
                chrome.storage.local.set(visitedSite);
            }
        }
        visitedSite.checked.push(url);
        chrome.storage.local.set(visitedSite);
        queue_req.dequeue();
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


async function isOpenSource(url) {
    let configUrl;
    let str = "";

    configUrl = await checkGitConfig(url);

    if (configUrl !== false) {
        str = configUrl.replace("github.com:", "github.com/");
        str = str.replace("gitlab.com:", "gitlab.com/");
        if (str.startsWith("ssh://")) {
            str = str.substring(6);
        }
        if (str.startsWith("git@")) {
            str = str.substring(4);
        }
        if (str.endsWith(".git")) {
            str = str.substring(0, str.length - 4);
        }
        if (str.startsWith("http") === false) {
            str = "https://" + str;
        }
        //console.log(str);

        if (isValidUrl(str)) {
            return await checkOpenSource(str);
        }
    }

    return false;
}

function isValidUrl(string) {
    try {
        new URL(string);
    } catch (_) {
        return false;
    }
    return true;
}

async function checkGitConfig(url) {
    const to_check = url + GIT_CONFIG_PATH;
    const search = new RegExp(GIT_CONFIG_SEARCH);
    let result = [];

    try {
        const response = await fetchWithTimeout(to_check, {
            redirect: "manual",
            timeout: 10000
        });

        if (response.status === 200) {
            let text = await response.text();
            if (text !== false && ((result = search.exec(text)) !== null)) {
                return result[1];
            }
        }
    } catch (error) {
        // Timeouts if the request takes longer than X seconds
        //console.log(error.name);
    }

    return false;
}

async function checkOpenSource(url) {
    try {
        const response = await fetchWithTimeout(url, {
            redirect: "manual",
            timeout: 10000
        });

        if (response.status === 200) {
            return url;
        }
    } catch (error) {
        // Timeouts if the request takes longer than X seconds
        //console.log(error.name);
    }

    return false;
}


async function checkSecuritytxt(url) {
    for (const element of SECURITYTXT_PATHS) {
        const to_check = url + element;
        const search = new RegExp(SECURITYTXT_SEARCH);

        try {
            const response = await fetchWithTimeout(to_check, {
                redirect: "manual",
                timeout: 10000
            });

            if (response.status === 200) {
                let text = await response.text();
                if (text !== false && ((search.exec(text)) !== null)) {
                    return to_check;
                }
            }
        } catch (error) {
            // Timeouts if the request takes longer than X seconds
            //console.log(error.name);
        }
    }
    return false;
}
