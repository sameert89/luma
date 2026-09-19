FROM mcr.microsoft.com/dotnet/sdk:10.0
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg python3 && rm -rf /var/lib/apt/lists/*
WORKDIR /workspace
CMD ["python3", "/source/tests/stage3/verify_readonly.py"]
