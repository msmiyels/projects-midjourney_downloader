# Python 3.11 image
FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Copy pyproject.toml and poetry.lock to working directory
COPY pyproject.toml poetry.lock* /app/

# Install poetry
RUN pip install poetry

# Install dependencies
RUN poetry install --no-dev

# Copy the current directory contents into the container to the working directory
COPY . /app

# Run bash shell when container is started
CMD ["bash"]
