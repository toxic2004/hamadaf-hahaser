# Uses Playwright's official image, which already has Chromium and all
# required system libraries installed - avoids the common "missing shared
# library" failure that happens when installing Playwright on a plain
# Node image without also installing its OS-level dependencies.
FROM mcr.microsoft.com/playwright:v1.46.0-jammy

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./

ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
