// add "view-source:" only in firefox, because chrome give this error: Not allowed to load local resource
let HREF_PREFIX = "";
if (typeof browser !== "undefined") {
    HREF_PREFIX = "view-source:";
}

let debug = false;

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
        let color = options.options.color;
        let list = document.getElementsByClassName("custom-color");
        for (let n = 0; n < list.length; ++n) {
            list[n].className += " " + color;
        }
        let max_sites = options.options.max_sites
        let hostElementFoundTitle = document.getElementById("hostsFoundTitle");
        hostElementFoundTitle.textContent = "Total found: 0 Max shown: " + max_sites;
    });
});


function addElements(element, array, callback, downloading, max_sites) {

    for (let i = array.length - 1; i > -1; i--) {
        if (i <= array.length - max_sites) {
            break;
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
        securitytxtStatus.setAttribute("class", "material-icons btn-small security");
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
            if (downloading.includes(callback(array[i]))) {
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
            openSourceStatus.setAttribute("class", "material-icons btn-small public");
            openSourceStatus.setAttribute("title", "The Website is OpenSource");
            openSourceStatus.setAttribute("href", callback(array[i].open));
            openSourceStatus.innerText = "public";

            link.setAttribute("href", HREF_PREFIX + callback(array[i].url) + "/.git/config");
            spanIcon.appendChild(btnDownload);
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
            btnBrowse.setAttribute("class", "material-icons btn-small green browse-dsstore");
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
        chrome.storage.local.set({
            checked: [],
            withExposedGit: [],
            downloading: []
        }, () => {
            // Ricarica solo il popup invece di ricaricare l'intera estensione
            window.location.reload();
        });
    } else if (button.classList.contains("download")) {
        const url = button.id.substring(3);

        button.setAttribute("class", "material-icons btn-small blue disabled");
        chrome.storage.local.get(["downloading"], function (downloading) {
            if (typeof downloading.downloading !== "undefined" && downloading.downloading.length !== 0) {
                downloading.downloading.push(url);
                chrome.storage.local.set({
                    downloading: downloading.downloading
                });
            } else {
                chrome.storage.local.set({
                    downloading: [url]
                });
            }
        });

        chrome.runtime.sendMessage({
            type: "download",
            url: url
        }, function () {
            button.setAttribute("class", "material-icons btn-small blue download");
        });
    } else if (button.classList.contains("delete")) {
        const split = button.id.split(":");
        const type = split[1];
        const url = split.slice(2).join(":");
        let indexDelete = null;

        button.setAttribute("class", "material-icons btn-small red disabled");
        chrome.storage.local.get(["withExposedGit"], function (result) {
            result.withExposedGit.forEach(function (obj, i) {
                if (obj.type === type && obj.url === url) {
                    indexDelete = i;
                }
            });

            if (indexDelete !== null) {
                result.withExposedGit.splice(indexDelete, 1);
                button.parentNode.parentNode.outerHTML = "";
                // change title
                const hostElementFoundTitle = document.getElementById("hostsFoundTitle");
                const split2 = hostElementFoundTitle.textContent.split(" ");
                const number = split2[2];
                const strTitle = split2.slice(3).join(" ");
                hostElementFoundTitle.textContent = "Total found: " + (number - 1) + " " + strTitle;

                chrome.storage.local.set({
                    withExposedGit: result.withExposedGit
                });
            }
        });
    } else if (button.classList.contains("browse-dsstore")) {
        const url = button.id.substring("dsbrowse:".length);
        openDsStoreBrowser(url);
    } else if (button.id === "dss-back") {
        dssNavigateBack();
    } else if (button.id === "dss-close") {
        dssClose();
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

document.addEventListener("DOMContentLoaded", function () {
    chrome.storage.local.get(["withExposedGit", "downloading", "options"], function (visitedSite) {
        if (typeof visitedSite.withExposedGit !== "undefined" && visitedSite.withExposedGit.length !== 0) {
            let hostElementFoundTitle = document.getElementById("hostsFoundTitle");
            let max_sites = visitedSite.options.max_sites
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
    let downloadStatusText = "";
    let downloadStatusArr = [];
    if (request.type === "downloadStatus") {
        downloadStatusText = document.getElementById("ds:" + request.url).innerText;
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
        document.getElementById("ds:" + request.url).innerText = downloadStatusArr.join("/");
    }
    sendResponse({status: true});

    // this will keep the message channel open to the other end until sendResponse is called
    return true;
});

async function checkPermissions() {
    try {
        // On Chrome, we have permissions by default from manifest
        if (typeof browser === 'undefined') {
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
        if (typeof browser === 'undefined') {
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
            debug = result.options.debug;
        }
    });

    // Only check permissions on Firefox
    if (typeof browser !== 'undefined') {
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

    chrome.storage.local.get(["options"], function (options) {
        let color = options.options.color;
        let list = document.getElementsByClassName("custom-color");
        for (let n = 0; n < list.length; ++n) {
            list[n].className += " " + color;
        }
        let max_sites = options.options.max_sites
        let hostElementFoundTitle = document.getElementById("hostsFoundTitle");
        hostElementFoundTitle.textContent = "Total found: 0 Max shown: " + max_sites;
    });
});


// ── DS_Store Browser Panel ─────────────────────────────────────────────────
//
// Navigation stack: array of { baseUrl, entries } objects.
// baseUrl is the directory URL (no trailing slash, no /.DS_Store suffix).
// entries is the sorted string[] of filenames parsed from that level's .DS_Store.
//
// The stack lets the Back button re-render previous levels without re-fetching.

let dssStack = [];

function dssSetBackVisibility() {
    document.getElementById("dss-back-li").style.display = dssStack.length > 1 ? "" : "none";
}

function dssOpenEntryInBackground(url) {
    if (chrome.tabs && chrome.tabs.create) {
        chrome.tabs.create({ url, active: false });
        return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
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
            if (navWrapper && !navWrapper.classList.contains(result.options.color)) {
                navWrapper.classList.add(result.options.color);
            }
        }
    });

    // Show overlay in loading state
    listEl.innerHTML = '';
    statusEl.style.display = "block";
    statusEl.textContent = "Loading...";
    pathEl.textContent = siteUrl;
    pathEl.title = siteUrl + "/.DS_Store";
    dssSetBackVisibility();
    overlay.style.display = "flex";

    await dssNavigateTo(siteUrl);
}

// Fetch, parse, and display the .DS_Store at baseUrl/.DS_Store.
// Pushes the result onto dssStack and renders the entry list.
async function dssNavigateTo(baseUrl) {
    // Ensure overlay is visible before navigation
    const overlay = document.getElementById("dss-overlay");
    if (overlay && overlay.style.display !== "flex") {
        overlay.style.display = "flex";
    }

    const dsUrl    = baseUrl + "/.DS_Store";
    const statusEl = document.getElementById("dss-status");
    const listEl   = document.getElementById("dss-list");
    const pathEl   = document.getElementById("dss-path");
    const backEl   = document.getElementById("dss-back");

    // Fallback: if any element is missing, abort navigation
    if (!statusEl || !listEl || !pathEl || !backEl) {
        debugLog("dssNavigateTo: Overlay or children missing, aborting navigation", { statusEl, listEl, pathEl, backEl });
        return;
    }

    listEl.innerHTML = '';
    statusEl.style.display = "block";
    statusEl.textContent = "Fetching\u2026";
    pathEl.textContent = baseUrl;
    pathEl.title = dsUrl;

    let entries;
    try {
        const response = await fetch(dsUrl, { redirect: "manual" });
        if (response.status !== 200) {
            throw new Error("HTTP " + response.status);
        }
        const buffer = await response.arrayBuffer();
        entries = parseDSStore(buffer);
    } catch (e) {
        statusEl.textContent = "Error: " + e.message;
        return;
    }

    // Push this level onto the navigation stack
    dssStack.push({ baseUrl, entries });
    dssSetBackVisibility();

    if (entries.length === 0) {
        statusEl.textContent = "No entries found in .DS_Store.";
        return;
    }

    statusEl.style.display = "none";
    dssRenderEntries(baseUrl, entries, listEl);
}

// Render the file list for a given directory level.
function dssRenderEntries(baseUrl, entries, listEl) {
    listEl.innerHTML = '';

    const itemPairs = entries.map(name => {
        const li = document.createElement("li");
        li.setAttribute("class", "collection-item dss-entry dss-loading");

        const icon = document.createElement("i");
        icon.setAttribute("class", "material-icons");
        icon.textContent = "folder";           // default; updated after probe

        const label = document.createElement("span");
        label.textContent = name;

        li.appendChild(icon);
        li.appendChild(label);
        listEl.appendChild(li);
        return { li, icon, label, name };
    });

    // Probe all entries for nested .DS_Store files in parallel
    itemPairs.forEach(({ li, icon, label, name }) => {
        dssProbeEntry(baseUrl, name).then(browsable => {
            li.classList.remove("dss-loading");

            if (browsable) {
                // Browsable directory: navigates on click
                li.classList.add("dss-browsable");
                icon.textContent = "folder_open";
                li.addEventListener("click", () => {
                    dssNavigateTo(baseUrl + "/" + encodeURIComponent(name));
                });
            } else {
                // Non-browsable: clicking opens the URL in a background tab.
                li.classList.add("dss-grey");
                li.setAttribute("title", "Open in a background tab");

                const entryUrl = baseUrl + "/" + encodeURIComponent(name);

                li.addEventListener("click", () => {
                    dssOpenEntryInBackground(entryUrl);
                });

                // Guess icon: entries with a file extension get a file icon
                const hasExtension = /\.[^./]+$/.test(name);
                icon.textContent = hasExtension ? "insert_drive_file" : "folder";
            }
        });
    });
}

// Returns true if baseUrl/name/.DS_Store exists and passes validation.
async function dssProbeEntry(baseUrl, name) {
    const probeUrl = baseUrl + "/" + encodeURIComponent(name) + "/.DS_Store";
    try {
        const fetchOpts = { redirect: "manual" };
        // AbortSignal.timeout is available in Chrome 103+ / Firefox 100+
        if (typeof AbortSignal !== "undefined" && AbortSignal.timeout) {
            fetchOpts.signal = AbortSignal.timeout(8000);
        }
        const response = await fetch(probeUrl, fetchOpts);
        if (response.status !== 200) return false;

        const buf = await response.arrayBuffer();
        if (buf.byteLength < 8) return false;

        const view = new DataView(buf);
        if (view.getUint32(0, false) !== 0x00000001) return false;
        const b = new Uint8Array(buf, 4, 4);
        // "Bud1" = 0x42 0x75 0x64 0x31
        return b[0] === 0x42 && b[1] === 0x75 && b[2] === 0x64 && b[3] === 0x31;
    } catch (_) {
        // Fail silently, likely network errors.
        return false;
    }
}

// Navigate back one level in the directory stack.
function dssNavigateBack() {
    if (dssStack.length <= 1) return;

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

    dssSetBackVisibility();
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
    dssSetBackVisibility();
}
