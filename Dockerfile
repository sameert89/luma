FROM node:24-bookworm-slim AS web
WORKDIR /build/src/Luma.Web
COPY src/Luma.Web/package*.json ./
RUN npm ci
COPY src/Luma.Web/ ./
RUN npm run build

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS server
WORKDIR /build
COPY global.json Directory.Build.props ./
COPY src/Luma.Server/ src/Luma.Server/
RUN dotnet restore src/Luma.Server --locked-mode
RUN dotnet publish src/Luma.Server -c Release --no-restore -o /app

FROM mcr.microsoft.com/dotnet/aspnet:10.0
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=server /app ./
COPY --from=web /build/src/Luma.Web/dist ./wwwroot
ENV ASPNETCORE_URLS=http://+:5080 Luma__DatabasePath=/data/luma.db Luma__Indexing__CachePath=/data/cache
EXPOSE 5080
ENTRYPOINT ["dotnet", "Luma.Server.dll"]
