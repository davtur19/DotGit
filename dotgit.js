const GIT_HEAD_HEADER = "ref: refs/heads/";
const GIT_HEAD_PATH = "/.git/HEAD";

const WS_SEARCH = /(ws)(s)?:\/\//;
const WS_REPLACE = "http$2://";


function checkGit(url, visitedSite) {
    let to_check = url + GIT_HEAD_PATH;

    fetch(to_check, {
        redirect: "manual"
    }).then(function(response) {
        if (response.status === 200) {
            return response.text();
        }
        return false;
    }).then(function(text) {
        if (text !== false && text.startsWith(GIT_HEAD_HEADER) === true) {
            visitedSite.withExposedGit.push(url);
            chrome.storage.local.set(visitedSite);

            chrome.browserAction.setBadgeText({
                text: visitedSite.withExposedGit.length.toString()
            });

            chrome.notifications.create({
                type: "basic",
                iconUrl: chrome.extension.getURL("icons/dotgit-48.png"),
                title: "Found an exposed .git",
                message: to_check
            });
        }
    });
}


chrome.storage.local.get(["checked", "withExposedGit"], function(visitedSite) {
    // Initialize the saved stats if not yet initialized.
    if (typeof visitedSite.checked === "undefined") {
        visitedSite = {
            checked: [],
            withExposedGit: []
        };

        chrome.storage.local.set(visitedSite);
    }

    chrome.webRequest.onCompleted.addListener(function(details) {
        let url = new URL(details["url"])["origin"];
        url = url.replace(WS_SEARCH, WS_REPLACE);

        if(url.startsWith("chrome-extension")) {
            return false;
        }

        if (visitedSite.checked.includes(url) === false) {
            visitedSite.checked.push(url);
            chrome.storage.local.set(visitedSite);
            checkGit(url, visitedSite);
        }
    }, {
        urls: ["<all_urls>"]
    });
});