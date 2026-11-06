FROM node:22-alpine
WORKDIR /app/gameserver
COPY gameserver/package.json gameserver/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY shared/ /app/shared/
COPY gameserver/ ./
USER node
EXPOSE 8081
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s CMD node -e "fetch('http://127.0.0.1:8081/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "index.js"]
