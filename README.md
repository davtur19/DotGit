[![Donate](https://img.shields.io/badge/Donate-PayPal-blue.svg)](https://paypal.me/davtur19)
[![FF users](https://img.shields.io/amo/users/dotgit?color=orange&label=Firefox%20users)](https://addons.mozilla.org/it/firefox/addon/dotgit/)
[![Chrome users](https://img.shields.io/chrome-web-store/users/pampamgoihgcedonnphgehgondkhikel?label=Chrome%20users)](https://chrome.google.com/webstore/detail/dotgit/pampamgoihgcedonnphgehgondkhikel)

# DotGit
An extension to check if .git is exposed in visited websites

## Features
- Check if a .git folder exists for each site you visit
- You will be notified when a .git folder is found
- List of sites found with the .git folder
- Download the entire .git folder in zip format, even if the files are not listed on the site
- View .git/config with one click
- Options for: colors, notifications and downloads

## How the download works
There is a queue for downloads, with a **maximum of simultaneous connections**; if this number is exceeded, subsequent files are put on **wait** for X ms multiplied by the number of downloads already pending; the result of the multiplication cannot exceed the **maximum wait**

More info [here](https://github.com/davtur19/DotGit/blob/b0f589dfd78396990b8d17e4268bd68471b4ff53/dotgit.js#L180-L192)

### Note:
- Downloading is an extra feature to DotGit, it is not meant to download large repositories (there are limits to the memory usable by extensions, and DotGit does everything in RAM)
- Changing the download settings is recommended as by default the values are kept low to avoid problems for those who do not have a good connection or a good CPU, however too high values could freeze the browser even on powerful computers

## Screenshot
![ScreenShot](https://user-images.githubusercontent.com/13476215/90319561-98ecb100-df39-11ea-876a-cc3c6d762932.png)

## Download: [Firefox](https://addons.mozilla.org/it/firefox/addon/dotgit/) | [Chrome](https://chrome.google.com/webstore/detail/dotgit/pampamgoihgcedonnphgehgondkhikel)
