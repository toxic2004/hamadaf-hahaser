# Uses Playwright's official image, which already has Chromium and all
# required system libraries installed - avoids the common "missing shared
# library" failure that happens when installing Playwright on a plain
# Node image without also installing its OS-level dependencies.
#
# IMPORTANT (2026-08-16, real deployment failure fixed): the npm
# "playwright" package version MUST exactly match this image's tag - a
# caret range like "^1.46.0" in package.json can resolve to a newer
# version whose browser binary isn't the one baked into this image,
# producing "Executable doesn't exist at /ms-playwright/...". package.json
# pins the exact version "1.46.0" (no caret) for this reason. If this
# image tag is ever bumped, package.json's pinned version must be bumped
# to match in the same change.
FROM mcr.microsoft.com/playwright:v1.46.0-jammy

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./

ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
