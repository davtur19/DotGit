const SLEEP = 150;

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

const GIT_WELL_KNOW_PATHS = [
    "HEAD",
    "objects/info/packs",
    "description",
    "config",
    "COMMIT_EDITMSG",
    "index",
    "packed-refs",
    "refs/heads/master",
    "refs/remotes/origin/HEAD",
    "refs/stash",
    "logs/HEAD",
    "logs/refs/heads/master",
    "logs/refs/remotes/origin/HEAD",
    "info/refs",
    "info/exclude"
];


function notification(title, message) {
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

            chrome.browserAction.setBadgeText({
                text: visitedSite.withExposedGit.length.toString()
            });

            notification("Found an exposed .git", to_check);
        }
    });
}


function startDownload(baseUrl, downloadFinished) {
    const downloadedFiles = [];
    const walkedPaths = [];

    let running_tasks = 0;
    let fileExist = false;

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
        if (running_tasks === 0) {
            let zip = new JSZip();

            downloadedFiles.forEach(function (file) {
                zip.file(file[0], file[1], {arrayBuffer: true});
            });

            zip.generateAsync({type: "blob"}).then(function (content) {
                // download zip
                const url = URL.createObjectURL(content);
                let filename = baseUrl.replace(/^http(s?):\/\//i, "").replace(".", "_");
                chrome.downloads.download({url: url, filename: `${filename}.zip`});
                downloadFinished(fileExist);
            });
        }
    }


    function downloadFile(path, decompress, callback) {
        if (walkedPaths.includes(path)) {
            return;
        }

        walkedPaths.push(path);
        running_tasks++;

        fetch(baseUrl + GIT_PATH + path, {
            redirect: "manual"
        }).then(function (response) {
            if (response.ok && response.status === 200) {
                fileExist = true;
                return response.arrayBuffer();
            }
        }).catch(function () {
            downloadZip();
        }).then(function (buffer) {
            setTimeout(function () {
                running_tasks--;
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
                }
                downloadZip();
            }, running_tasks * SLEEP);
        }).catch(function () {
            downloadZip();
        });
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

            matches.forEach((match) => {
                // make object path and download
                let path = GIT_OBJECTS_PATH + match.slice(0, 2) + "/" + match.slice(2);
                downloadFile(path, true, checkResult);
            });
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

            matches.forEach((match) => {
                let pathExt = GIT_PACK_PATH + match + GIT_PACK_EXT;
                let pathIdx = GIT_PACK_PATH + match + GIT_IDX_EXT;
                downloadFile(pathExt, false, function (a) {
                });
                downloadFile(pathIdx, false, function (a) {
                });
            });
        }
    }


    function checkResult(result) {
        checkTree(result);
        checkObject(result);
        checkPack(result);
    }

    // start download from well know paths
    GIT_WELL_KNOW_PATHS.forEach(function (path) {
        downloadFile(path, false, checkResult);
    });
}


chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    if (request.type === "download") {
        notification("Download status", "Download started\nPlease wait...");

        startDownload(request.url, function (fileExist) {
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

            if (fileExist) {
                notification("Download status", "Downloaded " + request.url);
                sendResponse({status: true});
            } else {
                notification("Download status", "Failed to download " + request.url + "\nNo files found");
                sendResponse({status: false});
            }
            chrome.notifications.create(notification);
        });
    }

    // this will keep the message channel open to the other end until sendResponse is called
    return true;
});


chrome.storage.local.get(["checked", "withExposedGit"], function (visitedSite) {
    // Initialize the saved stats if not yet initialized.
    if (typeof visitedSite.checked === "undefined") {
        visitedSite = {
            checked: [],
            withExposedGit: [],
            downloading: []
        };
        chrome.storage.local.set(visitedSite);
    }

    chrome.webRequest.onCompleted.addListener(function (details) {
        let url = new URL(details["url"])["origin"];
        // replace ws and wss with http and https
        url = url.replace(WS_SEARCH, WS_REPLACE);

        if (url.startsWith("chrome-extension")) {
            return false;
        }

        // save visited sites
        if (visitedSite.checked.includes(url) === false) {
            visitedSite.checked.push(url);
            chrome.storage.local.set(visitedSite);
            checkGit(url, visitedSite);
        }
    }, {
        urls: ["<all_urls>"]
    });
});