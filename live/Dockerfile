FROM mcr.microsoft.com/dotnet/sdk:11.0.100@sha256:65f3c7c6a25a239ab3e6719f2896147e7b68242ff2d8818dd70498bde6ef8bea AS sdk
ENV DOTNET_CLI_TELEMETRY_OPTOUT=1

FROM sdk AS fixture-packages
WORKDIR /restore
COPY global.json ./
COPY fixture/ ./
RUN dotnet restore Submission.csproj --locked-mode --packages /feed -p:NuGetAudit=false

FROM sdk AS fixture
COPY --from=fixture-packages /feed/ /feed/

FROM sdk AS grader-packages
WORKDIR /restore
COPY global.json ./
COPY fixture/ submission/
COPY graders/Grader.csproj graders/packages.lock.json graders/
RUN dotnet restore graders/Grader.csproj --locked-mode --packages /feed -p:NuGetAudit=false

FROM node:26.13.0-trixie-slim@sha256:5adad64f9a1fca2d51972caa65983634c8a774eb300d72b20f7f2a0f60368072 AS node
FROM sdk AS grader
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=grader-packages /feed/ /feed/
WORKDIR /opt/agent-dx
COPY global.json run.mts report.mts ./
COPY fixture/ fixture/
COPY tasks/ tasks/
COPY graders/ graders/
COPY solutions/mutations.json solutions/
