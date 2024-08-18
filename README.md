[![Donate](https://img.shields.io/badge/Donate-PayPal-blue.svg)](https://paypal.me/davtur19)
[![FF users](https://img.shields.io/amo/users/dotgit?color=orange&label=Firefox%20users)](https://addons.mozilla.org/it/firefox/addon/dotgit/)
[![Chrome users](https://img.shields.io/chrome-web-store/users/pampamgoihgcedonnphgehgondkhikel?label=Chrome%20users)](https://chrome.google.com/webstore/detail/dotgit/pampamgoihgcedonnphgehgondkhikel)

# DotGit

An extension for checking if .git is exposed in visited websites

## Features

- Check if a .git/.svn/.hg folder exists for each site you visit
- Check if a .env file exists for each site you visit
- Check if a .DS_Store file exists for each site you visit (Thanks to [@rodnt](https://github.com/rodnt))
- Check if the site is open source (github/gitlab)
- Check if the site has security.txt
- You will be notified when a folder is found
- List of exposed sites found
- Download the entire .git folder in zip format, even if the files are not listed on the site
- View .git/config with one click
- Options for: colors, notifications and downloads

_Some checks are turned off by default, open the settings to turn them on_
## How the download works

There is a queue for downloads, with a **maximum of simultaneous connections**; if this number is exceeded, subsequent
files are put on **wait** for X ms multiplied by the number of downloads already pending; the result of the
multiplication cannot exceed the **maximum wait**

More info [here](https://github.com/davtur19/DotGit/blob/b0f589dfd78396990b8d17e4268bd68471b4ff53/dotgit.js#L180-L192)

### Note:

- Downloading is an extra feature to DotGit, it is not meant to download large repositories (there are limits to the
  memory usable by extensions, and DotGit does everything in RAM)
- Changing the download settings is recommended as by default the values are kept low to avoid problems for those who do
  not have a good connection or a good CPU, however too high values could freeze the browser even on powerful computers
- By default, svn, mercurial and dotenv are disabled, to activate them just go to settings and turn them on

## Screenshot

![ScreenShot](https://user-images.githubusercontent.com/13476215/213874632-6f05c28e-1e90-487e-a0d9-f619b9b69e1a.png)

## Download: [Firefox](https://addons.mozilla.org/it/firefox/addon/dotgit/) | [Chrome](https://chrome.google.com/webstore/detail/dotgit/pampamgoihgcedonnphgehgondkhikel)
