FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8028 DATA_DIR=/app/data
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --chown=node:node server.js workspace.js gateway.js index.html ./
COPY --chown=node:node lib ./lib
COPY --chown=node:node assets ./assets
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
EXPOSE 8028
HEALTHCHECK --interval=30s --timeout=8s --start-period=10s --retries=3 CMD node -e "require('node:http').get({hostname:'127.0.0.1',port:8028,path:'/healthz',headers:{Host:process.env.APP_ALLOWED_HOST||'127.0.0.1:8028'}},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "gateway.js"]
