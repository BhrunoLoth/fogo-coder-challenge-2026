# F.O.G.O. em contêiner (opcional).
# O jeito mais simples de rodar continua sendo o iniciar.bat / npm start, que só precisa do Node.js 18+.
FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production \
    NO_BROWSER=1 \
    PORT=3000

# Não há npm install: o servidor não tem dependências e a interface já vai compilada em public/.
COPY --chown=node:node package.json ./
COPY --chown=node:node server ./server
COPY --chown=node:node public ./public
COPY --chown=node:node data ./data

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/meta').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "server/index.js"]
