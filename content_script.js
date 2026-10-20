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
    const GIT_CONFIG_SEARCH = "url = (.*(github\\.com|gitlab\\.com).*)";
    const GIT_OBJECTS_SEARCH = "[a-f0-9]{40}";

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
    const SECURITYTXT_SEARCH = "Contact: ";

    // Helper function to make fetch requests with timeout
    async function fetchWithTimeout(resource, options = {}) {
        const {timeout = 10000} = options;

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

    // Check for exposed Git repository
    async function checkGit(url) {
        const to_check = url + GIT_HEAD_PATH;
        const search = new RegExp("^" + GIT_OBJECTS_SEARCH);

        try {
            debugLog('Checking Git HEAD:', to_check);
            const response = await fetchWithTimeout(to_check, {
                timeout: 10000
            });

            debugLog('Response status:', response.status);
            debugLog('Response headers:', response.headers && response.headers.get ?
                'Headers available' : 'Headers not available');

            if (response.status === 200) {
                const text = await response.text();
                debugLog('Git HEAD content:', text);
                debugLog('Content length:', text.length);
                debugLog('Starts with header?', text.startsWith(GIT_HEAD_HEADER));
                debugLog('Matches hash?', search.test(text));

                if (text.startsWith(GIT_HEAD_HEADER) || search.test(text)) {
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
    async function checkSvn(url) {
        const to_check = url + SVN_DB_PATH;

        try {
            const response = await fetchWithTimeout(to_check, {
                timeout: 10000
            });

            if (response.status === 200) {
                const text = await response.text();
                if (text.startsWith(SVN_DB_HEADER)) {
                    return true;
                }
            }
        } catch (error) {
            // Ignore error
        }

        return false;
    }

    // Check for exposed Mercurial repository
    async function checkHg(url) {
        const to_check = url + HG_MANIFEST_PATH;

        try {
            const response = await fetchWithTimeout(to_check, {
                timeout: 10000
            });

            if (response.status === 200) {
                const text = await response.text();
                if (HG_MANIFEST_HEADERS.some(header => text.startsWith(header))) {
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
    // dotenv file, on the other hand, starts with an assignment (or comments) and
    // is mostly made of them, so check the shape instead of a single match.
    // Keys may be lowercase/mixed case: Node's own .env parser accepts them.
    function looksLikeEnvFile(text) {
        const isAssignment = (line) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(line);
        let first = null;
        let assignments = 0;
        let meaningful = 0;

        for (const raw of text.split(/\r?\n/)) {
            const line = raw.trim();
            if (line === "" || line.startsWith("#")) {
                continue;
            }
            if (first === null) {
                first = line;
            }
            meaningful++;
            if (isAssignment(line)) {
                assignments++;
            }
        }

        return first !== null && isAssignment(first) && assignments / meaningful >= 0.5;
    }

    // Check for exposed .env file
    async function checkEnv(url) {
        const to_check = url + ENV_PATH;

        try {
            const response = await fetchWithTimeout(to_check, {
                timeout: 10000
            });

            if (response.status === 200) {
                return looksLikeEnvFile(await response.text());
            }
        } catch (error) {
            // Ignore error
        }

        return false;
    }

    // Check for exposed .DS_Store file
    async function checkDSStore(url) {
        const to_check = url + DS_STORE;

        try {
            const response = await fetchWithTimeout(to_check, {
                timeout: 10000
            });

            if (response.status === 200) {
                const text = await response.text();
                if (text.startsWith(DS_STORE_HEADER)) {
                    return true;
                }
            }
        } catch (error) {
            // Ignore error
        }

        return false;
    }

    // Check for security.txt file
    async function checkSecuritytxt(url) {
        for (const path of SECURITYTXT_PATHS) {
            const to_check = url + path;
            const search = new RegExp(SECURITYTXT_SEARCH);

            try {
                const response = await fetchWithTimeout(to_check, {
                    timeout: 10000
                });

                if (response.status === 200) {
                    const text = await response.text();
                    if (search.test(text)) {
                        return to_check;
                    }
                }
            } catch (error) {
                // Ignore error
            }
        }
        return false;
    }

    async function checkGitConfig(url) {
        const to_check = url + GIT_CONFIG_PATH;
        const search = new RegExp(GIT_CONFIG_SEARCH);
        let result = [];

        try {
            const response = await fetchWithTimeout(to_check, {
                timeout: 10000
            });

            if (response.status === 200) {
                let text = await response.text();
                if (text !== false && ((result = search.exec(text)) !== null)) {
                    return result[1];
                }
            }
        } catch (error) {
            // Ignore error
        }

        return false;
    }

    // Cross-origin requests run in the page context and are blocked by the
    // page's CORS policy: the background owns the host permissions, so it is
    // the one that probes github/gitlab.
    async function checkOpenSource(url) {
        return new Promise((resolve) => {
            // A background that never answers must not hold the whole scan: the
            // probe is only an icon, report the finding without it. Five seconds
            // more than the background abort, so a slow answer still arrives.
            const timer = setTimeout(() => resolve(false), 35000);
            chrome.runtime.sendMessage({type: "CHECK_OPEN_SOURCE", url: url}, function (response) {
                clearTimeout(timer);
                void chrome.runtime.lastError;
                resolve(response && response.open === true ? url : false);
            });
        });
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

            try {
                new URL(str);
                return await checkOpenSource(str);
            } catch (_) {
                return false;
            }
        }

        return false;
    }

    async function checkSite(url, options) {
        try {
            debugLog('Starting site check for:', url);

            // Run core checks in parallel
            const [git, svn, hg, env, ds_store] = await Promise.all([
                options.functions.git ? checkGit(url) : Promise.resolve(false),
                options.functions.svn ? checkSvn(url) : Promise.resolve(false),
                options.functions.hg ? checkHg(url) : Promise.resolve(false),
                options.functions.env ? checkEnv(url) : Promise.resolve(false),
                options.functions.ds_store ? checkDSStore(url) : Promise.resolve(false)
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
                    options.check_securitytxt ? checkSecuritytxt(url) : Promise.resolve(false),
                    git && options.check_opensource ? isOpenSource(url) : Promise.resolve(false)
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

        if (request.type === "CHECK_SITE") {
            const {url, options} = request;
            debug = options.debug;
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