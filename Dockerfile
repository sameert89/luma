# syntax=docker/dockerfile:1
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS server
WORKDIR /build
# Keep restore cached when only source code changes.
COPY global.json Directory.Build.props ./
COPY src/Luma.Server/Luma.Server.csproj src/Luma.Server/packages.lock.json src/Luma.Server/
RUN dotnet restore src/Luma.Server --locked-mode --disable-parallel
COPY src/Luma.Server/ src/Luma.Server/
# Bound compiler concurrency and avoid a resident compiler server on small hosts.
RUN DOTNET_PROCESSOR_COUNT=2 dotnet publish src/Luma.Server -c Release --no-restore \
    --disable-build-servers -m:1 -p:UseSharedCompilation=false -o /app

FROM node:24-bookworm-slim AS web
WORKDIR /build/src/Luma.Web
COPY src/Luma.Web/package*.json ./
RUN npm ci --no-audit --no-fund
COPY src/Luma.Web/ ./
ARG NODE_BUILD_HEAP_MB=768
# The mount creates a dependency on the completed server build. BuildKit must
# finish publishing before starting TypeScript/Vite; nothing is copied into dist.
RUN --mount=type=bind,from=server,source=/app,target=/server-build \
    NODE_OPTIONS="--max-old-space-size=${NODE_BUILD_HEAP_MB}" \
    RAYON_NUM_THREADS=2 UV_THREADPOOL_SIZE=2 npm run build

FROM mcr.microsoft.com/dotnet/aspnet:10.0
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=server /app ./
COPY --from=web /build/src/Luma.Web/dist ./wwwroot
ENV ASPNETCORE_URLS=http://+:5080 Luma__DatabasePath=/data/luma.db Luma__Indexing__CachePath=/data/cache
EXPOSE 5080
ENTRYPOINT ["dotnet", "Luma.Server.dll"]
