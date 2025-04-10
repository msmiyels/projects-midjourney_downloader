# Use an official Python runtime
FROM python:3.11-slim

# Non-root user arguments
ARG USERNAME=user
ARG USER_UID=1000
ARG USER_GID=$USER_UID

# System requirements
RUN apt-get update && apt-get install -y --no-install-recommends \
    && pip install --no-cache-dir uv \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Add non-root user
RUN groupadd --gid $USER_GID $USERNAME \
    && useradd --uid $USER_UID --gid $USER_GID --create-home --shell /bin/bash $USERNAME

# Change working directory
WORKDIR /app

# Add path for uv venv
ENV VENV_PATH=/opt/venv

# Create venv and set ownership to non-root user
RUN uv venv $VENV_PATH --python python3.11 --seed \
    && chown -R $USERNAME:$USER_GID $VENV_PATH

# Add venv to path and take care that uv run python uses this path
ENV PATH="$VENV_PATH/bin:$PATH"
ENV VIRTUAL_ENV=$VENV_PATH

# Switch to non-root user
USER $USERNAME

# Copy project and set ownership
COPY --chown=$USERNAME:$USER_GID . /app

# Define installation arguments
ARG USE_DEV=false

# Install dependencies based on the boolean argument
RUN if [ "$USE_DEV" = "true" ]; then \
        uv sync --active; \
    else \
        uv sync --no-dev --active; \
    fi

# Run bash
CMD ["/bin/bash"]