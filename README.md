# MidJourney Downloader Suite

<!-- badges -->
<p align="center">Easily bulk download all your MidJourney AI generated images and associated prompts</p>

<p align="center">
    <img src="https://img.shields.io/badge/JavaScript-Language?style=flat&label=Language&color=F7DF1E" alt="Language"/>
    <img src="https://img.shields.io/website?&url=https%3A%2F%2Fmsmiyels.github.io%2Fprojects-midjourney_downloader%2F&up_color=green&down_color=dc3545&logo=github&label=GitHub%20Pages&up_message=Up&down_message=Down" alt="Website"/>
    <a href="https://github.com/msmiyels/projects-midjourney_downloader?tab=MIT-1-ov-file">
    <img src="https://img.shields.io/github/license/msmiyels/projects-midjourney_downloader?style=flat&label=License&color=0056cc" alt="License"/>
    </a>    
</p>
<!-- /badges -->

## Motivation 🏴‍☠️

Since MidJourney does not offer an API or advanced features to download generated images and related information,
(or just on an image-by-image base), it was kind of time to build something that helps storing the metadata of all the 
created images in bulk processing, making it available for organization and analysis/search.

Getting all images or information alongside the generations such as prompts and model versions is simple, but 
not yet a trivial click-and-run adventure. The initial idea/code was published by the YouTube channel
[AI Revolution Zone](https://www.youtube.com/@airevolutionzone), but is outdated and does not work with
the current MidJourney version (as of 2025/04/01 - no joke here 😂).

## Overview 🧰

This repository provides some functionalities to extract 🖍️ information of your generated MidJourney content and
download 📸 the images. Since everything is `JavaScript` based, you just need a **webbrowser** such as `Safari`
or `Chrome` that provides a development mode and **console**.

It extracts:
- Job ID
- Source path (URL)
- Prompt
- Model version
- Additional tags such as ar, chaos, niji, style, stylize etc. in separate columns

Results will be saved as `.csv`

Post extraction, the downloader can be used to obtain the images. 
This tool will also handle duplicates (so you won't get any duplicate images or metadata at the end).
Additionally, the tool offers filtering capabilities to download only specific images by actions such as 'remix', 'upscale', or 'zoom' if available in the CSV.

## Hands-on 🚀
### Website
The easiest way to use the tool is by visiting the respective [GitHub Pages Site](https://msmiyels.github.io/projects-midjourney_downloader/),
follow the instructions there and have fun 🎉.

### Running the tools locally
1. Clone the repository: `git clone https://github.com/msmiyels/projects-midjourney_downloader.git`
2. Navigate to the `app/` subdirectory, located in the cloned repository root 
3. Open the `index.html` file in your browser (requires a JS server in the background - if started from within a JetBrains IDE, this is going to be automatically started)
4. Follow the instructions on the page
