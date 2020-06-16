const DEFAULT_OPTIONS = {
    "color": "grey",
    "max_sites": 100,
    "notification": {
        "new_git": true,
        "download": true
    },
    "download": {
        "wait": 100,
        "max_wait": 10000,
        "max_connections": 20
    }
};

const WS_SEARCH = /(ws)(s)?:\/\//;
const WS_REPLACE = "http$2://";

const GIT_PATH = "/.git/";
const GIT_HEAD_PATH = GIT_PATH + "HEAD";
const GIT_HEAD_HEADER = "ref: refs/heads/";
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
    "refs/remotes/origin/HEAD",
    "refs/stash",
    "logs/HEAD",
    "logs/refs/stash",
    "logs/refs/heads/master",
    "logs/refs/remotes/origin/HEAD",
    "info/refs",
    "info/exclude"
];

let wait;
let max_wait;
let max_connections;
let notification_new_git;
let notification_download;


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
        iconUrl: chrome.extension.getURL("icons/dotgit-48.png"),
        title: title,
        message: message
    });
}


function checkGit(url, visitedSite) {
    let to_check = url + GIT_HEAD_PATH;

    fetch(to_check, {
        redirect: "manual"
    }).then(function (response) {
        if (response.status === 200) {
            return response.text();
        }
        return false;
    }).then(function (text) {
        if (text !== false && text.startsWith(GIT_HEAD_HEADER) === true) {
            // .git found
            visitedSite.withExposedGit.push(url);
            chrome.storage.local.set(visitedSite);
            // Not supported on Firefox for Android
            if (chrome.browserAction.setBadgeText) {
                chrome.browserAction.setBadgeText({
                    text: visitedSite.withExposedGit.length.toString()
                });
            }

            notification("Found an exposed .git", to_check);
        }
    });
}


function startDownload(baseUrl, downloadFinished) {
    const downloadedFiles = [];
    const walkedPaths = [];

    let running_tasks = 0;
    let fileExist = false;
    let downloadStats = {};

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

            zip.generateAsync({type: "blob"}).then(function (content) {
                // download zip
                const url = URL.createObjectURL(content);
                chrome.downloads.download({url: url, filename: `${filename}.zip`});
                downloadFinished(fileExist, downloadStats);
            });
        }
    }

    let waiting = 0;

    function downloadFile(path, decompress, callback) {
        if (walkedPaths.includes(path)) {
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

            fetch(baseUrl + GIT_PATH + path, {
                redirect: "manual"
            }).then(function (response) {
                downloadStats[response.status] = (typeof downloadStats[response.status] === "undefined") ? 1 : downloadStats[response.status] + 1;
                if (response.ok && response.status === 200) {
                    fileExist = true;
                    return response.arrayBuffer();
                }
                running_tasks--;
            }).then(function (buffer) {
                if (typeof buffer !== "undefined") {
                    downloadedFiles.push([path, buffer]);
                    const words = new Uint8Array(buffer);

                    if (decompress) {
                        // decompress objects
                        let data = pako.ungzip(words);
                        callback(arrayBufferToString(data));
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
    notification_new_git = options.notification.new_git;
    notification_download = options.notification.download;
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
    }

    if (request.type === "notification_new_git") {
        notification_new_git = request.value;
        sendResponse({status: true});
    } else if (request.type === "notification_download") {
        notification_download = request.value;
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

    chrome.storage.local.set({options: checkOptions(DEFAULT_OPTIONS, result.options)});

    set_options(result.options);

    chrome.webRequest.onCompleted.addListener(function (details) {
        let url = new URL(details["url"])["origin"];
        // replace ws and wss with http and https
        url = url.replace(WS_SEARCH, WS_REPLACE);

        if (url.startsWith("chrome-extension")) {
            return false;
        }

        // save visited sites
        if (result.checked.includes(url) === false) {
            result.checked.push(url);
            chrome.storage.local.set(result);
            checkGit(url, result);
        }
    }, {
        urls: ["<all_urls>"]
    });
});

// Reset download status at each start
chrome.storage.local.set({
    downloading: []
});