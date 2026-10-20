"use strict";

if (typeof window.dotGitInjected === 'undefined') {
    window.dotGitInjected = true;

    let debug = false;

    function debugLog(...args) {
        if (debug) {
            console.log('[DotGit]', ...args);
        }
    }

    debugLog("Content script initialized");

    // Content script for checking exposed Git repositories and sensitive files
    const GIT_PATH = "/.git/";
    const GIT_HEAD_PATH = GIT_PATH + "HEAD";
    const GIT_CONFIG_PATH = GIT_PATH + "config";
    const GIT_HEAD_HEADER = "ref: refs/heads/";
    const GIT_CONFIG_SEARCH = /url = (.*(github\.com|gitlab\.com).*)/;
    const GIT_OBJECTS_SEARCH = /^[a-f0-9]{40}/;

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

    const DS_STORE = "/.DS_Store";
    const DS_STORE_HEADER = "\x00\x00\x00\x01Bud1";

    const SECURITYTXT_PATHS = [
        "/.well-known/security.txt",
        "/security.txt",
    ];
    const SECURITYTXT_SEARCH = /Contact: /;

    // Every check shares one request timeout, so a slow connection is tuned in
    // one place. The option is in seconds (default 15), like the download one.
    const DEFAULT_REQUEST_TIMEOUT = 15000;
    const MIN_REQUEST_TIMEOUT = 5000;
    const MAX_REQUEST_TIMEOUT = 300000;

    function requestTimeout(options) {
        const seconds = Number(options && options.request_timeout);
        return Number.isFinite(seconds) ?
            Math.min(Math.max(seconds * 1000, MIN_REQUEST_TIMEOUT), MAX_REQUEST_TIMEOUT) :
            DEFAULT_REQUEST_TIMEOUT;
    }

    // Helper function to make fetch requests with timeout
    async function fetchWithTimeout(resource, options = {}) {
        const {timeout = DEFAULT_REQUEST_TIMEOUT} = options;

        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeout);

        try {
            return await fetch(resource, {
                ...options,
                signal: controller.signal
            });
        } finally {
            clearTimeout(id);
        }
    }

    // A page answers any path with any body: refuse what a check does not need
    // instead of buffering it. Content-Length catches the honest case, the
    // decoded length catches chunked or compressed responses.
    async function readText(response, maxBytes) {
        const declared = Number(response.headers.get("content-length"));
        if (Number.isFinite(declared) && declared > maxBytes) {
            return null;
        }
        const text = await response.text();
        return text.length > maxBytes ? null : text;
    }

    // Check for exposed Git repository
    async function checkGit(url, timeout) {
        const to_check = url + GIT_HEAD_PATH;

        try {
            debugLog('Checking Git HEAD:', to_check);
            const response = await fetchWithTimeout(to_check, {
                timeout
            });

            debugLog('Response status:', response.status);

            if (response.status === 200) {
                const text = await readText(response, 64 * 1024);
                if (text === null) {
                    return false;
                }
                debugLog('Git HEAD content:', text);

                if (text.startsWith(GIT_HEAD_HEADER) || GIT_OBJECTS_SEARCH.test(text)) {
                    debugLog('Git repository found!');
                    return true;
                }
                debugLog('Content does not match Git patterns');
            } else {
                debugLog('Response not OK:', response.status, response.statusText);
            }
        } catch (error) {
            debugLog('Error checking Git:', error);
        }

        debugLog('No Git repository found at:', to_check);
        return false;
    }

    // Check for exposed SVN repository
    async function checkSvn(url, timeout) {
        const to_check = url + SVN_DB_PATH;

        try {
            const response = await fetchWithTimeout(to_check, {
                timeout
            });

            if (response.status === 200) {
                const text = await readText(response, 64 * 1024);
                if (text !== null && text.startsWith(SVN_DB_HEADER)) {
                    return true;
                }
            }
        } catch (error) {
            // Ignore error
        }

        return false;
    }

    // Check for exposed Mercurial repository
    async function checkHg(url, timeout) {
        const to_check = url + HG_MANIFEST_PATH;

        try {
            const response = await fetchWithTimeout(to_check, {
                timeout
            });

            if (response.status === 200) {
                const text = await readText(response, 64 * 1024);
                if (text !== null && HG_MANIFEST_HEADERS.some(header => text.startsWith(header))) {
                    return true;
                }
            }
        } catch (error) {
            // Ignore error
        }

        return false;
    }

    // A page that answers 200 with prose (a soft 404, an SPA fallback) can still
    // contain "something=value", and a 404 page can echo the requested path. A
    // dotenv file, on the other hand, is only assignments and comments: reject the
    // document as soon as a meaningful line is neither.
    // Keys may be lowercase/mixed case and "KEY = value" (spaces around "=") is
    // valid dotenv syntax: Node's own .env parser accepts both.
    function looksLikeEnvFile(text) {
        // A dotenv file is text: a binary object (an image, a gzip) served at
        // /.env decodes with control bytes or replacement characters.
        if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFD]/.test(text)) {
            return false;
        }
        // `export KEY=value` is how shell-sourced env files are written, and it is
        // common enough in the wild to be accepted here.
        const isAssignment = (line) => /^(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=/.test(line);
        // A double-quoted value may span several lines (a PEM key): those lines
        // belong to the assignment, not to the prose. Escapes do not count.
        const countQuotes = (value) => (value.replace(/\\./g, "").match(/"/g) || []).length;
        let found = false;
        let openQuote = false;

        for (const raw of text.split(/\r?\n/)) {
            const line = raw.trim();
            if (openQuote) {
                if (countQuotes(line) % 2 === 1) {
                    openQuote = false;
                }
                continue;
            }
            if (line === "" || line.startsWith("#")) {
                continue;
            }
            // Prose, HTML, JSON, XML: not a dotenv line.
            if (!isAssignment(line)) {
                return false;
            }
            found = true;
            const value = line.slice(line.indexOf("=") + 1).trim();
            // A page that echoes the requested path ("path=/.env") is a 404 page:
            // a dotenv file never contains that value.
            if (value === ENV_PATH || value.startsWith(ENV_PATH + "?")) {
                return false;
            }
            openQuote = value.startsWith('"') && countQuotes(value) % 2 === 1;
        }

        // An assignment whose value is still open at the end is malformed.
        return found && !openQuote;
    }

    // Check for exposed .env file
    async function checkEnv(url, timeout) {
        const to_check = url + ENV_PATH;

        try {
            const response = await fetchWithTimeout(to_check, {
                timeout
            });

            if (response.status === 200) {
                const text = await readText(response, 1024 * 1024);
                return text !== null && looksLikeEnvFile(text);
            }
        } catch (error) {
            // Ignore error
        }

        return false;
    }

    // Check for exposed .DS_Store file
    async function checkDSStore(url, timeout) {
        const to_check = url + DS_STORE;

        try {
            const response = await fetchWithTimeout(to_check, {
                timeout
            });

            if (response.status === 200) {
                const text = await readText(response, 1024 * 1024);
                if (text !== null && text.startsWith(DS_STORE_HEADER)) {
                    return true;
                }
            }
        } catch (error) {
            // Ignore error
        }

        return false;
    }

    // Check for security.txt file
    async function checkSecuritytxt(url, timeout) {
        for (const path of SECURITYTXT_PATHS) {
            const to_check = url + path;

            try {
                const response = await fetchWithTimeout(to_check, {
                    timeout
                });

                if (response.status === 200) {
                    const text = await readText(response, 256 * 1024);
                    if (text !== null && SECURITYTXT_SEARCH.test(text)) {
                        return to_check;
                    }
                }
            } catch (error) {
                // Ignore error
            }
        }
        return false;
    }

    async function checkGitConfig(url, timeout) {
        const to_check = url + GIT_CONFIG_PATH;

        try {
            const response = await fetchWithTimeout(to_check, {
                timeout
            });

            if (response.status === 200) {
                const text = await readText(response, 64 * 1024);
                const result = text === null ? null : GIT_CONFIG_SEARCH.exec(text);
                if (result !== null) {
                    return result[1];
                }
            }
        } catch (error) {
            // Ignore error
        }

        return false;
    }

    // The page's CORS policy blocks cross-origin fetches to github/gitlab, so the
    // background probes the repository page with the same request timeout; a
    // closed port just means "not open source".
    function checkOpenSource(url) {
        return chrome.runtime.sendMessage({type: "CHECK_OPEN_SOURCE", url: url})
            .then((response) => (response && response.open === true ? url : false))
            .catch(() => false);
    }

    // Turn a git remote into its repository page: git@host:path, ssh://git@host/path
    // and plain host/path (the config often omits the scheme).
    function repoPageUrl(remote) {
        const str = remote.trim()
            .replace(/^git@([^:]+):/, "https://$1/")
            .replace(/^ssh:\/\/git@/, "https://")
            .replace(/\.git$/, "");
        return /^https?:\/\//.test(str) ? str : "https://" + str;
    }

    async function isOpenSource(url, timeout) {
        const remote = await checkGitConfig(url, timeout);
        return remote === false ? false : checkOpenSource(repoPageUrl(remote));
    }

    async function checkSite(url, options) {
        try {
            debugLog('Starting site check for:', url);

            const timeout = requestTimeout(options);

            // Run core checks in parallel
            const functions = options.functions || {};
            const [git, svn, hg, env, ds_store] = await Promise.all([
                Boolean(functions.git) ? checkGit(url, timeout) : Promise.resolve(false),
                Boolean(functions.svn) ? checkSvn(url, timeout) : Promise.resolve(false),
                Boolean(functions.hg) ? checkHg(url, timeout) : Promise.resolve(false),
                Boolean(functions.env) ? checkEnv(url, timeout) : Promise.resolve(false),
                Boolean(functions.ds_store) ? checkDSStore(url, timeout) : Promise.resolve(false)
            ]);

            debugLog('Check results:', {git, svn, hg, env, ds_store});

            const types = [];
            if (git) types.push('git');
            if (svn) types.push('svn');
            if (hg) types.push('hg');
            if (env) types.push('env');
            if (ds_store) types.push('ds_store');

            debugLog('Found types:', types);

            // Enrichment checks (security.txt, opensource) only run after a
            // real finding is detected, to avoid useless requests
            let securitytxt = false;
            let opensource = false;
            if (types.length > 0) {
                [securitytxt, opensource] = await Promise.all([
                    Boolean(options.check_securitytxt) ? checkSecuritytxt(url, timeout) : Promise.resolve(false),
                    Boolean(git) && Boolean(options.check_opensource) ? isOpenSource(url, timeout) : Promise.resolve(false)
                ]);

                // One message for all types: the background stores them together
                // and sends a single notification listing every exposure.
                debugLog('Sending findings:', types);
                await new Promise((resolve) => {
                    chrome.runtime.sendMessage({
                        type: "FINDINGS_FOUND",
                        data: {
                            url: url,
                            types: types,
                            opensource: opensource,
                            securitytxt: securitytxt
                        }
                    }, response => {
                        debugLog('Background response:', response);
                        void chrome.runtime.lastError;
                        resolve();
                    });
                });
            }

            return {
                git,
                svn,
                hg,
                env,
                ds_store,
                securitytxt,
                opensource
            };
        } catch (error) {
            debugLog('Error during checks:', error);
            return {
                git: false,
                svn: false,
                hg: false,
                env: false,
                ds_store: false,
                securitytxt: false,
                opensource: false,
                error: error.message
            };
        }
    }

    // Listen for messages from the background script
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        debugLog('Received message:', request);

        // The background asks this before injecting the content script again.
        // Without an answer the port closes and every scan looks like a page
        // that still needs the script.
        if (request.type === "PING") {
            sendResponse({ok: true});
            return false;
        }

        if (request.type === "CHECK_SITE") {
            const {url, options} = request;
            debug = Boolean(options.debug);
            debugLog('Checking site:', url, 'with options:', options);

            // Run checks based on enabled options
            checkSite(url, options).then((results) => {
                sendResponse(results);
            }).catch(error => {
                debugLog('Error during checks:', error);
                sendResponse({
                    git: false,
                    svn: false,
                    hg: false,
                    env: false,
                    ds_store: false,
                    securitytxt: false,
                    opensource: false,
                    error: error.message
                });
            });

            return true; // Keep the message channel open for async response
        }
    });

    debugLog('Content script setup complete');
} 