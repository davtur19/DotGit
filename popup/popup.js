// Firefox exposes browser.* (and needs the "view-source:" prefix), but recent
// Chromium versions define a global `browser` object too, so testing the
// namespace alone is not a Firefox test. getBrowserInfo only exists on Firefox.
"use strict";

const IS_FIREFOX = typeof browser !== "undefined" &&
    typeof browser.runtime?.getBrowserInfo === "function";

// add "view-source:" only in firefox, because chrome give this error: Not allowed to load local resource
let HREF_PREFIX = IS_FIREFOX ? "view-source:" : "";

let debug = false;

// The theme is a CSS class name read from storage: accept only the values the
// options page offers, so a hand-edited value cannot add arbitrary classes.
const THEME_COLORS = ["grey", "red", "green", "blue", "yellow", "orange", "purple", "pink", "brown"];

function themeColor(value) {
    const color = String(value);
    return THEME_COLORS.includes(color) ? color : "grey";
}

// A server that accepts the .DS_Store request and never answers used to leave
// the overlay on "Loading..." for as long as the popup stayed open. Same option
// and same range as the checks in the content script.
let fetchTimeoutMs = 15000;

function setFetchTimeout(value) {
    const seconds = Number(value);
    fetchTimeoutMs = (Number.isFinite(seconds) ? Math.min(Math.max(seconds, 5), 300) : 15) * 1000;
}

// Open Source Initiative keyhole, drawn inline so the list needs no extra
// request: "public" (a globe) said little about a repository being open source.
// Vector by Colin Viebrock for the Open Source Initiative, CC BY 2.5.
const OPEN_SOURCE_ICON =
    '<svg viewBox="0 0 590 590" aria-hidden="true" focusable="false"><path d="M328.7 395.8c40.3-15 61.4-43.8 ' +
    '61.4-93.4S348.3 209 296 208.9c-55.1-.1-96.8 43.6-96.1 93.5s24.4 83 62.4 94.9L195 563C104.8 539.7 13.2 ' +
    '433.3 13.2 302.4 13.2 147.3 137.8 21.5 294 21.5s282.8 125.7 282.8 280.8c0 133-90.8 237.9-182.9 ' +
    '261.1L328.7 395.8z"/></svg>';

function debugLog(...args) {
    if (debug) {
        console.log('[DotGit]', ...args);
    }
}

// Not supported on Firefox for Android
if (typeof chrome.browserAction !== "undefined" && typeof chrome.browserAction.setBadgeText !== "undefined") {
    chrome.browserAction.setBadgeText({
        text: ""
    });
    // set width for desktop devices
    // not working anymore on chrome, fixed with css
    /*document.addEventListener("DOMContentLoaded", function () {
        document.getElementById("hostsFound").style.width = "380px";
    });*/
} else if (typeof chrome.action !== "undefined" && typeof chrome.action.setBadgeText !== "undefined") {
    chrome.action.setBadgeText({
        text: ""
    });
}


document.addEventListener("DOMContentLoaded", function () {
    chrome.storage.local.get(["options"], function (options) {
        if (!options.options) return;
        const color = themeColor(options.options.color);
        const list = document.getElementsByClassName("custom-color");
        for (let n = 0; n < list.length; ++n) {
            list[n].className += " " + color;
        }
    });
});


function addElements(element, array, callback, downloading, max_sites) {
    // A hand-edited storage can hold a non-array here: never let a bad value take
    // the whole list down (the entries below get the same tolerance).
    const activeDownloads = Array.isArray(downloading) ? downloading : [];

    for (let i = array.length - 1; i > -1; i--) {
        if (i < array.length - max_sites) {
            break;
        }
        // Storage can hold junk from an old version or a hand edit: one bad
        // entry must not take the whole list (and the popup) down.
        if (array[i] === null || typeof array[i] !== "object") {
            continue;
        }

        /*
        <li class="collection-item">
            <span class="secondary-content">
                    <i class="material-icons btn-small download">file_download</i>
            </span>
            <span class="truncate">
                <a href="https://example.org/">testtesttesttesttesttesttesttesttesttesttesttest</a>
            </span>
        </li>
        */
        const listItem = document.createElement("li");
        listItem.setAttribute("class", "collection-item");

        const spanLink = document.createElement("span");
        spanLink.setAttribute("class", "truncate");

        const spanIcon = document.createElement("span");
        spanIcon.setAttribute("class", "secondary-content");

        const link = document.createElement("a");

        // delete from list button
        const spanDeleteWebsite = document.createElement("span");
        spanDeleteWebsite.setAttribute("class", "secondary-content");
        const deleteWebsite = document.createElement("i");
        deleteWebsite.setAttribute("id", "del:" + array[i].type + ":" + callback(array[i].url));
        deleteWebsite.setAttribute("class", "material-icons btn-small red delete");
        deleteWebsite.setAttribute("title", "Delete website from the list");
        deleteWebsite.innerText = "delete";
        spanDeleteWebsite.appendChild(deleteWebsite);
        listItem.appendChild(spanDeleteWebsite);

        const spanSecuritytxtStatus = document.createElement("span");
        spanSecuritytxtStatus.setAttribute("class", "secondary-content");
        const securitytxtStatus = document.createElement("a");
        securitytxtStatus.setAttribute("class", "material-icons btn-small security-color security");
        securitytxtStatus.setAttribute("title", "The Website has security.txt");
        securitytxtStatus.setAttribute("href", HREF_PREFIX + callback(array[i].securitytxt));
        securitytxtStatus.innerText = "security";
        spanSecuritytxtStatus.appendChild(securitytxtStatus);


        if (callback(array[i].type) === "git") {
            const spanDownloadStatus = document.createElement("span");
            spanDownloadStatus.setAttribute("class", "secondary-content truncate");
            const spanOpenSourceStatus = document.createElement("span");
            spanOpenSourceStatus.setAttribute("class", "secondary-content");

            const btnDownload = document.createElement("i");
            btnDownload.setAttribute("id", "db:" + callback(array[i].url));
            if (activeDownloads.includes(callback(array[i].url))) {
                btnDownload.setAttribute("class", "material-icons btn-small blue disabled");
            } else {
                btnDownload.setAttribute("class", "material-icons btn-small blue download");
            }
            btnDownload.setAttribute("title", "Download all files from the .git folder");
            btnDownload.innerText = "file_download";

            const downloadStatus = document.createElement("div");
            downloadStatus.setAttribute("class", "download-status");
            downloadStatus.setAttribute("id", "ds:" + callback(array[i].url))
            downloadStatus.setAttribute("title", "success/failed/total");
            downloadStatus.innerText = "";

            const openSourceStatus = document.createElement("a");
            openSourceStatus.setAttribute("class", "btn-small opensource-color opensource");
            openSourceStatus.setAttribute("title", "The Website is OpenSource");
            openSourceStatus.setAttribute("href", callback(array[i].open));
            openSourceStatus.innerHTML = OPEN_SOURCE_ICON;

            link.setAttribute("href", HREF_PREFIX + callback(array[i].url) + "/.git/config");
            // Firefox for Android has no downloads API (removed in 79): the scan
            // works there, the download button would not.
            if (chrome.downloads && chrome.downloads.download) {
                spanIcon.appendChild(btnDownload);
            }
            spanDownloadStatus.appendChild(downloadStatus);
            spanOpenSourceStatus.appendChild(openSourceStatus);
            listItem.appendChild(spanIcon);
            if (callback(array[i].open) !== "false" && callback(array[i].open) !== "undefined") {
                // check if it has the old version values (4.5)
                if (callback(array[i].open) === "true") {
                    openSourceStatus.setAttribute("href", "about:blank");
                }
                listItem.appendChild(spanOpenSourceStatus);
            }
            if (callback(array[i].securitytxt) !== "false" && callback(array[i].securitytxt) !== "undefined") {
                listItem.appendChild(spanSecuritytxtStatus);
            }
            listItem.appendChild(spanDownloadStatus);
        }
        if (callback(array[i].type) === "svn") {
            if (callback(array[i].securitytxt) !== "false" && callback(array[i].securitytxt) !== "undefined") {
                listItem.appendChild(spanSecuritytxtStatus);
            }
            link.setAttribute("href", HREF_PREFIX + callback(array[i].url) + "/.svn/");
        }
        if (callback(array[i].type) === "hg") {
            if (callback(array[i].securitytxt) !== "false" && callback(array[i].securitytxt) !== "undefined") {
                listItem.appendChild(spanSecuritytxtStatus);
            }
            link.setAttribute("href", HREF_PREFIX + callback(array[i].url) + "/.hg/");
        }
        if (callback(array[i].type) === "env") {
            if (callback(array[i].securitytxt) !== "false" && callback(array[i].securitytxt) !== "undefined") {
                listItem.appendChild(spanSecuritytxtStatus);
            }
            link.setAttribute("href", HREF_PREFIX + callback(array[i].url) + "/.env");
        }
        if (callback(array[i].type) === "ds_store") {
            const spanBrowse = document.createElement("span");
            spanBrowse.setAttribute("class", "secondary-content");
            const btnBrowse = document.createElement("i");
            btnBrowse.setAttribute("id", "dsbrowse:" + callback(array[i].url));
            btnBrowse.setAttribute("class", "material-icons btn-small amber darken-3 browse-dsstore");
            btnBrowse.setAttribute("title", "Browse .DS_Store file listing");
            btnBrowse.innerText = "folder_open";
            spanBrowse.appendChild(btnBrowse);
            listItem.appendChild(spanBrowse);

            if (callback(array[i].securitytxt) !== "false" && callback(array[i].securitytxt) !== "undefined") {
                listItem.appendChild(spanSecuritytxtStatus);
            }
            link.setAttribute("href", HREF_PREFIX + callback(array[i].url) + "/.DS_Store");
        }
        link.innerText = callback(array[i].url);

        spanLink.appendChild(link);
        listItem.appendChild(spanLink);
        element.appendChild(listItem);
    }
}


document.addEventListener("click", async (event) => {
    const button = event.target;

    if (button.id === "request-permissions") {
        await requestPermissions();
    } else if (button.id === "reset") {
        // The background owns these lists: it writes them under the same lock
        // used by the scanner, so a finding stored meanwhile is not wiped.
        chrome.runtime.sendMessage({type: "RESET_STATE"}, function () {
            void chrome.runtime.lastError;
            window.location.reload();
        });
    } else if (button.classList.contains("download")) {
        const url = button.id.substring(3);

        button.setAttribute("class", "material-icons btn-small blue disabled");
        // The background records the pending download before starting it.
        chrome.runtime.sendMessage({
            type: "download",
            url: url
        }, function () {
            void chrome.runtime.lastError;
            button.setAttribute("class", "material-icons btn-small blue download");
        });
    } else if (button.classList.contains("delete")) {
        // id is "del:<type>:<url>"
        const split = button.id.split(":");
        const findingType = split[1];
        const url = split.slice(2).join(":");
        const listItem = button.closest("li");

        button.setAttribute("class", "material-icons btn-small red disabled");
        chrome.runtime.sendMessage({
            type: "DELETE_FINDING",
            findingType: findingType,
            url: url
        }, function (response) {
            void chrome.runtime.lastError;
            if (!response || !response.removed) {
                button.setAttribute("class", "material-icons btn-small red delete");
                return;
            }
            if (listItem) {
                listItem.remove();
            }
            setFoundTitle(response.remaining);
        });
    } else if (button.classList.contains("browse-dsstore")) {
        const url = button.id.substring("dsbrowse:".length);
        openDsStoreBrowser(url);
    } else if (button.closest && button.closest("#dss-back")) {
        dssNavigateBack();
    } else if (button.id === "options") {
        if (chrome.runtime.openOptionsPage) {
            chrome.runtime.openOptionsPage();
        } else {
            window.open(chrome.runtime.getURL('options.html'));
        }
    } else if (button.id === "about") {
        window.open(chrome.runtime.getURL('about.html'));
    }
});

// The back control is a link without an href, so Enter/Space need handling.
document.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    if (!event.target.closest || !event.target.closest("#dss-back")) return;
    event.preventDefault();
    dssNavigateBack();
});

function setFoundTitle(count) {
    const title = document.getElementById("hostsFoundTitle");
    const shown = /Max shown: (\d+)/.exec(title.textContent);
    title.textContent = "Total found: " + count + " Max shown: " + (shown ? shown[1] : 100);
}


document.addEventListener("DOMContentLoaded", function () {
    chrome.storage.local.get(["withExposedGit", "downloading", "options"], function (visitedSite) {
        // Do not skip rendering when options are not written yet: the popup can
        // open before the background has initialised them.
        const storedMaxSites = Number(visitedSite.options?.max_sites);
        const maxSites = Number.isFinite(storedMaxSites)
            ? Math.min(Math.max(Math.trunc(storedMaxSites), 1), 1000000000)
            : 100;
        setFetchTimeout(visitedSite.options?.request_timeout);
        document.getElementById("hostsFoundTitle").textContent =
            "Total found: 0 Max shown: " + maxSites;
        if (typeof visitedSite.withExposedGit !== "undefined" && visitedSite.withExposedGit.length !== 0) {
            let hostElementFoundTitle = document.getElementById("hostsFoundTitle");
            let max_sites = maxSites;
            hostElementFoundTitle.textContent = "Total found: " + visitedSite.withExposedGit.length + " Max shown: " + max_sites;

            let hostElementFound = document.getElementById("hostsFound");
            if (typeof visitedSite.downloading !== "undefined" && visitedSite.downloading.length !== 0) {
                addElements(hostElementFound, visitedSite.withExposedGit, function (url) {
                    return `${url}`;
                }, visitedSite.downloading, max_sites);
            } else {
                addElements(hostElementFound, visitedSite.withExposedGit, function (url) {
                    return `${url}`;
                }, [], max_sites);
            }
        }
    });
});


chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    // The popup only tracks download progress. Other messages (FINDINGS_FOUND,
    // GIT_FOUND, ...) belong to the background: answering them here would resolve
    // the content script's await before the background has written to storage.
    if (request.type !== "downloadStatus") {
        return false;
    }

    const statusElement = document.getElementById("ds:" + request.url);
    if (!statusElement) {
        return false;
    }

    let downloadStatusText = statusElement.innerText;
    let downloadStatusArr = [];
    if (downloadStatusText === "") {
        downloadStatusText = "0/0/0";
    }
    downloadStatusArr = downloadStatusText.split("/");
    if (request.downloadStatus.successful) {
        downloadStatusArr[0] = request.downloadStatus.successful.toString();
    }
    if (request.downloadStatus.failed) {
        downloadStatusArr[1] = request.downloadStatus.failed.toString();
    }
    if (request.downloadStatus.total) {
        downloadStatusArr[2] = request.downloadStatus.total.toString();
    }
    statusElement.innerText = downloadStatusArr.join("/");

    sendResponse({status: true});
    return false;
});

async function checkPermissions() {
    try {
        // On Chrome, we have permissions by default from manifest
        if (!IS_FIREFOX) {
            return true;
        }

        // Only check permissions on Firefox
        const hasPermissions = await browser.permissions.contains({
            origins: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"]
        });
        return hasPermissions;
    } catch (error) {
        debugLog('Error checking permissions:', error);
        return false;
    }
}

async function requestPermissions() {
    try {
        // On Chrome, we don't need to request permissions
        if (!IS_FIREFOX) {
            return true;
        }

        // Only request permissions on Firefox
        const granted = await browser.permissions.request({
            origins: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"]
        });
        if (granted) {
            document.getElementById('permissions-banner').style.display = 'none';
            // Reload popup to show contents
            window.location.reload();
        }
        return granted;
    } catch (error) {
        debugLog('Error requesting permissions:', error);
        return false;
    }
}

document.addEventListener("DOMContentLoaded", async function () {
    // Load options to get debug value
    chrome.storage.local.get(["options"], function (result) {
        if (result.options && typeof result.options.debug !== "undefined") {
            debug = Boolean(result.options.debug);
        }
    });

    // Only check permissions on Firefox
    if (IS_FIREFOX) {
        const hasPermissions = await checkPermissions();
        if (!hasPermissions) {
            document.getElementById('permissions-banner').style.display = 'block';
        } else {
            document.getElementById('permissions-banner').style.display = 'none';
        }
    } else {
        // On Chrome, hide the banner by default
        document.getElementById('permissions-banner').style.display = 'none';
    }
});


// ── DS_Store Browser Panel ─────────────────────────────────────────────────
//
// Navigation stack: array of { baseUrl, entries } objects.
// baseUrl is the directory URL (no trailing slash, no /.DS_Store suffix).
// entries is the sorted string[] of filenames parsed from that level's .DS_Store.
//
// Entries are not classified up front. Checking every name for its own
// .DS_Store meant one request per row as soon as the list opened; now a click
// fetches just that entry and either browses it or opens it in a tab.

let dssStack = [];

function dssOpenEntryInBackground(url) {
    if (chrome.tabs && chrome.tabs.create) {
        chrome.tabs.create({ url, active: false });
        return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
}

function dssIsBackgroundOpenEvent(event) {
    return event.button === 1 || event.ctrlKey || event.metaKey;
}

function dssEntryUrl(baseUrl, name) {
    return baseUrl + "/" + encodeURIComponent(name);
}

// Fetch and parse baseUrl/.DS_Store. HTTP failures carry `status`; network and
// parse failures do not, so callers can tell "not a browsable folder" from
// "the request itself failed".
const MAX_DS_STORE_BYTES = 20 * 1024 * 1024;

async function dssFetchEntries(baseUrl) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), fetchTimeoutMs);

    try {
        const response = await fetch(baseUrl + "/.DS_Store", {
            cache: "no-store",
            signal: controller.signal
        });
        if (response.status !== 200) {
            const error = new Error("HTTP " + response.status);
            error.status = response.status;
            throw error;
        }
        // The body comes from the site: never buffer an unbounded one in the
        // popup. A real .DS_Store is a few MB even for a huge folder.
        const declared = Number(response.headers.get("content-length"));
        if (Number.isFinite(declared) && declared > MAX_DS_STORE_BYTES) {
            throw new Error(".DS_Store too large (" + declared + " bytes)");
        }
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength > MAX_DS_STORE_BYTES) {
            throw new Error(".DS_Store too large (" + buffer.byteLength + " bytes)");
        }
        return parseDSStore(buffer);
    } catch (error) {
        if (error.name === "AbortError") {
            throw new Error("timed out after " + (fetchTimeoutMs / 1000) + " s");
        }
        throw error;
    } finally {
        // Also covers the body: the abort must stay armed until it has settled.
        clearTimeout(timer);
    }
}

// Open the overlay and fetch the root-level .DS_Store for the given site URL.
async function openDsStoreBrowser(siteUrl) {
    dssStack = [];

    const overlay  = document.getElementById("dss-overlay");
    const listEl   = document.getElementById("dss-list");
    const statusEl = document.getElementById("dss-status");
    const pathEl   = document.getElementById("dss-path");

    // Apply the user's chosen colour theme to the overlay nav (mirrors main nav init)
    chrome.storage.local.get(["options"], function (result) {
        if (result.options && result.options.color) {
            const navWrapper = document.querySelector("#dss-nav .nav-wrapper");
            const color = themeColor(result.options.color);
            if (navWrapper && !navWrapper.classList.contains(color)) {
                navWrapper.classList.add(color);
            }
        }
    });

    // Show overlay in loading state
    listEl.innerHTML = '';
    statusEl.style.display = "block";
    statusEl.textContent = "Loading...";
    pathEl.textContent = siteUrl;
    pathEl.title = siteUrl + "/.DS_Store";
    document.body.classList.add("dss-open");
    overlay.style.display = "flex";

    await dssNavigateTo(siteUrl);
}

// Fetch, parse and display the .DS_Store at baseUrl/.DS_Store.
// Pushes the result onto dssStack and renders the entry list. `presetEntries`
// is used after a click already fetched that level, to avoid a second request.
async function dssNavigateTo(baseUrl, presetEntries) {
    // Ensure overlay is visible before navigation
    const overlay = document.getElementById("dss-overlay");
    if (overlay && overlay.style.display !== "flex") {
        overlay.style.display = "flex";
    }

    const statusEl = document.getElementById("dss-status");
    const listEl   = document.getElementById("dss-list");
    const pathEl   = document.getElementById("dss-path");

    // Fallback: if any element is missing, abort navigation
    if (!statusEl || !listEl || !pathEl) {
        debugLog("dssNavigateTo: Overlay or children missing, aborting navigation", { statusEl, listEl, pathEl });
        return;
    }

    const previous = dssStack[dssStack.length - 1] || null;

    listEl.innerHTML = '';
    statusEl.style.display = "block";
    statusEl.textContent = "Fetching\u2026";
    pathEl.textContent = baseUrl;
    pathEl.title = baseUrl + "/.DS_Store";

    let entries;
    try {
        entries = presetEntries || await dssFetchEntries(baseUrl);
    } catch (e) {
        statusEl.textContent = "Error: " + e.message;
        // Do not throw away the listing the user was looking at.
        if (previous) {
            pathEl.textContent = previous.baseUrl;
            pathEl.title = previous.baseUrl + "/.DS_Store";
            dssRenderEntries(previous.baseUrl, previous.entries, listEl);
        }
        return;
    }

    dssStack.push({ baseUrl, entries });

    if (entries.length === 0) {
        statusEl.textContent = "No entries found in .DS_Store.";
        return;
    }

    statusEl.style.display = "none";
    statusEl.textContent = "";
    dssRenderEntries(baseUrl, entries, listEl);
}

// Render the file list for a given directory level.
function dssRenderEntries(baseUrl, entries, listEl) {
    listEl.innerHTML = '';

    for (const name of entries) {
        const li = document.createElement("li");
        li.setAttribute("class", "collection-item dss-entry");
        li.tabIndex = 0;
        li.setAttribute("role", "button");
        li.setAttribute("title", name);

        const label = document.createElement("span");
        label.setAttribute("class", "dss-name");
        label.textContent = name;

        const icon = document.createElement("i");
        icon.setAttribute("class", "material-icons");
        icon.textContent = "chevron_right";

        li.appendChild(label);
        li.appendChild(icon);
        listEl.appendChild(li);

        li.addEventListener("click", (event) => {
            if (dssIsBackgroundOpenEvent(event)) {
                dssOpenEntryInBackground(dssEntryUrl(baseUrl, name));
                return;
            }
            dssOpenEntry(li, baseUrl, name);
        });

        // Middle click: open in a background tab without fetching anything.
        li.addEventListener("auxclick", (event) => {
            if (event.button !== 1) return;
            event.preventDefault();
            dssOpenEntryInBackground(dssEntryUrl(baseUrl, name));
        });

        li.addEventListener("keydown", (event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            dssOpenEntry(li, baseUrl, name);
        });
    }
}

// A click fetches only that entry's .DS_Store. If it exists the entry is a
// browsable folder; otherwise it is opened in a tab. This is the only request
// the browser makes per entry, and it happens on an explicit action.
async function dssOpenEntry(li, baseUrl, name) {
    if (li.classList.contains("dss-loading")) return;

    const entryUrl = dssEntryUrl(baseUrl, name);
    li.classList.add("dss-loading");

    let entries;
    try {
        entries = await dssFetchEntries(entryUrl);
    } catch (e) {
        li.classList.remove("dss-loading");
        dssOpenEntryInBackground(entryUrl);
        return;
    }

    li.classList.remove("dss-loading");
    await dssNavigateTo(entryUrl, entries);
}

// Navigate back one level, or leave the browser at the site root.
function dssNavigateBack() {
    if (dssStack.length <= 1) {
        dssClose();
        return;
    }

    // Always show overlay before navigation
    const overlay = document.getElementById("dss-overlay");
    if (overlay) overlay.style.display = "flex";

    dssStack.pop();  // discard current level
    const prev     = dssStack[dssStack.length - 1];
    const listEl   = document.getElementById("dss-list");
    const pathEl   = document.getElementById("dss-path");
    const statusEl = document.getElementById("dss-status");

    pathEl.textContent = prev.baseUrl;
    pathEl.title = prev.baseUrl + "/.DS_Store";
    statusEl.style.display = "none";
    listEl.innerHTML = '';
    dssRenderEntries(prev.baseUrl, prev.entries, listEl);
}

// Close the overlay and reset state.
function dssClose() {
    dssStack = [];
    const overlay  = document.getElementById("dss-overlay");
    const listEl   = document.getElementById("dss-list");
    const statusEl = document.getElementById("dss-status");

    overlay.style.display = "none";
    listEl.innerHTML = '';
    statusEl.style.display = "none";
    statusEl.textContent = "Loading...";
    document.body.classList.remove("dss-open");
}
