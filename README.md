# Download YouTube Channel and Playlist Information


## Motivation 🏴‍☠️

Since MidJourney does not offer an API or advanced features to download generated images and related information,
(or just on an image-by-image base), it was kind of time to build something that helps storing the metadata of all the 
created images in bulk processing, making it available for organization and analysis/search.

Getting all images or information alongside the generations such as prompts and model versions is simple, but 
not yet a trivial click-and-run adventure. The initial idea/code was published by the YouTube channel
[AI Revolution Zone](https://www.youtube.com/watch?v=0lCtou4TfII&t=5s), but is outdated and does not work with
the current MidJourney version (as of 2025/04/01 - no joke here 😂).

## Overview 🧰

This repository provides some functionalities to extract information of your generated MidJourney content.

### 1. Extraction of metadata 🖍️
This functionality does **not** need any `Python` environment at all. You just need a **webbrowser** such as `Safari`
or `Chrome` that provides a development mode and **console**.

It extracts:
- Job ID
- Source path (URL)
- Prompt
- Model version
- Additional tags such as ar, chaos, niji, style, stylize etc. in separate columns

Results will be saved as `.csv`

### 2. Planned features 📋
1. Python based <br>
1.1 Remove duplicates (all columns)<br>
1.2 Add download of images <br>
1.3 Add local paths to images after download

2. GenAI-based (API)<br>
2.1 Tag images based on prompt (genAI-based)<br>
2.2 Tag images based on image content (gen-AI-based)<br>
2.3 Provide support for [OpenWebUI](https://openwebui.com/) as an alternative for API-based tagging<br>

## Installation 👾
You need this for `Python` features only!

1. Clone the repository
2. Open a terminal instance and navigate to the repository directory
3. Create a virtual environment and install dependencies

### Conda installation
1. Create a Conda environment and install dependencies:

    ```bash
    conda env create -f environment.yml
    conda activate miyels-mj_hackz
   ```
   
   You can provide your own environment name by adding the name tag `--name your-env-name`.<p>


2. Install the package locally in editable mode:

    ```bash
    pip install -e .
    ```

### Docker installation
1. Create the Docker image<p>
   **Without development dependencies**:
    ```bash
    docker build -t miyels/mj_hackz:latest --no-cache .
    ```
   
    **With development dependencies**:
    ```bash
    docker build -t miyels/mj_hackz:latest --no-cache --build-arg USE_DEV=true .
    ```

2. Start the Docker containery<p>
   **Manually**<p>
   ```bash
   docker run -it --rm mj_hackz
   ```
   
   To attach a local directory, use
   
      ```bash
      docker run -it --rm -v /path/to/local/dir:/app/local_dir mj_hackz
      ```

   **Automatically**<p>
   Use the shell script `setup/docker_run.sh` to start the Docker container automatically 
   (without development depencencies). This option also exposes port `8888` for JupyterLab and mounts the
   `app` folder from the repository to `/app`.
<p>

3. The Docker installation is based on [uv](https://docs.astral.sh/uv/) to keep the image 
   as small and the installation as fast as possible.<p>
If you want to run uv commands inside the container, please always use the `--active` flage, like

   ```bash
   uv run python --active
   ```
   Otherwise, it will start to install the virtual environment into the local GitHub folder, which is not intended.
   If you already got over this issue, you can safely delete the `.venv` folder in the repository, since it is 
   correctly installed inside the container in `opt/venv`.
   

## Further documentation
Read the documentation in [docs](docs) to get started and for more information.
