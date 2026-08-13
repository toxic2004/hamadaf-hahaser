FROM apify/actor-node-playwright-chrome:24-1.61.1

COPY --chown=myuser:myuser package*.json ./
RUN npm --quiet set progress=false \
    && npm install --omit=dev --omit=optional \
    && echo "Installed NPM packages:" \
    && (npm list --omit=dev --all || true)

COPY --chown=myuser:myuser . ./

CMD npm start --silent
