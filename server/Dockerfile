# Orion Team Racing game server. Build from the REPO ROOT (the server imports the pure game modules in src/):
#   docker build -f server/Dockerfile -t otr-server .
#   docker run -d --name otr-server --network host --restart always -e PUBLIC_IP=<wan ip, optional> otr-server
# Host networking: WebRTC needs the ONE UDP port (UDP_PORT, default 8956) reachable as-is (ICE mux).
# See server/README.md for env vars, ports and the ops checklist.
FROM node:22-bookworm-slim
WORKDIR /app/server
ENV NODE_ENV=production PORT=8955 UDP_PORT=8956
COPY server/package.json server/package-lock.json ./
# node-datachannel (under @geckos.io/server) fetches its prebuilt linux-x64 binary here
RUN npm ci --omit=dev && npm cache clean --force
COPY src /app/src
COPY server/*.js ./
EXPOSE 8955/tcp 8956/udp
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8955)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "index.js"]
