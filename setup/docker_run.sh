#!/bin/bash

echo "Creating Docker container..."
cd "$(dirname "$0")/.." || exit

docker run -it --name mj_hackz \
    -p 8888:8888 \
    -v "$(pwd)":/app \
    miyels/mj_hackz:latest \
    /bin/bash