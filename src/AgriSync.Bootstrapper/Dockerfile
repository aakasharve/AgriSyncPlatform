# syntax=docker/dockerfile:1.7

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
ARG BUILD_CONFIGURATION=Release

WORKDIR /src

# Keep SDK selection deterministic across local and CI builds.
COPY global.json ./

# Copy backend source tree and publish Bootstrapper.
COPY src ./src
RUN dotnet restore ./src/AgriSync.Bootstrapper/AgriSync.Bootstrapper.csproj
RUN dotnet publish ./src/AgriSync.Bootstrapper/AgriSync.Bootstrapper.csproj \
    --configuration $BUILD_CONFIGURATION \
    --output /app/publish \
    --no-restore \
    /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app

ENV ASPNETCORE_URLS=http://+:8080
ENV DOTNET_EnableDiagnostics=0

EXPOSE 8080

COPY --from=build /app/publish ./
ENTRYPOINT ["dotnet", "AgriSync.Bootstrapper.dll"]
