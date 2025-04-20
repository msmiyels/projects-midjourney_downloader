# Download MidJourney Metadata and Download Images


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

## Hands-on 🚀
### Website
The easiest way to use the tool is by visiting the respective [GitHub Pages Site](https://msmiyels.github.io/projects-midjourney_downloader/),
follow the instructions there and have fun 🎉.

### Running the tools locally
1. Clone the repository: `git clone https://github.com/msmiyels/projects-mj_downloader.git`
2. Navigate to the `app/` subdirectory, located in the cloned repository root 
3. Open the `index.html` file in your browser
4. Follow the instructions on the page
