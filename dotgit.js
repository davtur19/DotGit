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
            visitedSite.withExposedGit.push(to_check);
            browser.storage.local.set(visitedSite);

            browser.browserAction.setBadgeText({
                text: visitedSite.withExposedGit.length.toString()
            });

            browser.notifications.create({
                type: "basic",
                iconUrl: browser.extension.getURL("icons/dotgit-48.png"),
                title: "Found an exposed .git",
                message: to_check
            });
        }
    });
}


browser.storage.local.get().then(visitedSite => {
    // Initialize the saved stats if not yet initialized.
    if (typeof visitedSite.checked === "undefined") {
        visitedSite = {
            checked: [],
            withExposedGit: []
        };

        browser.storage.local.set(visitedSite);
    }

    browser.webRequest.onCompleted.addListener(function(details) {
        let url = new URL(details["url"])["origin"];
        url = url.replace(WS_SEARCH, WS_REPLACE);

        if (visitedSite.checked.includes(url) === false) {
            visitedSite.checked.push(url);
            browser.storage.local.set(visitedSite);
            checkGit(url, visitedSite);
        }
    }, {
        urls: ["<all_urls>"]
    });
});