# 🔥 F.O.G.O. — Ferramenta Onisciente de Gestão e Operações

**Coder Challenge 2026 · DSIN · Etapa Bônus — "Uma cidade que pensa à frente"**
Central de operações de trânsito e segurança para **Marília/SP**: inventário inteligente, central em tempo real e cidade preditiva.

> **O fogo devolvido aos humanos.** No mito, Prometeu roubou o fogo do Olimpo e o entregou aos humanos. No Protocolo Prometheus, a IA tomou o controle porque as pessoas deixaram de entender os sistemas que usavam. O F.O.G.O. faz o caminho inverso: **nenhuma decisão é uma caixa-preta.** Toda previsão mostra os fatores que a geraram, toda recomendação passa por aprovação humana e o próprio sistema mostra **o quanto acertou ontem**.

---

## ▶ Como rodar (1 minuto)

**Requisito único:** [Node.js 18 ou mais novo](https://nodejs.org). **Não é preciso `npm install`**: o projeto não tem dependências de execução.

| Sistema | Como iniciar |
|---|---|
| **Windows** | Dê dois cliques em **`iniciar.bat`** |
| **Linux / macOS** | `./iniciar.sh` ou `node server/index.js` |
| **Qualquer um** | `npm start` |

O navegador abre sozinho em **http://localhost:3000**. Se a porta estiver ocupada, o sistema tenta automaticamente 3001, 3002…

- Na **primeira execução** a cidade é gerada (bairros, 260 equipamentos, 76 agentes e 90 dias de histórico) em cerca de 1 segundo.
- Os dados ficam em `data/fogo.sqlite`. Para recomeçar do zero: `npm run reset`.
- Testes automatizados do motor: `npm test`.
- Sem internet, o sistema continua funcionando. Só o mapa de fundo (OpenStreetMap, sem chave de API; reserva: Esri) deixa de aparecer.

---

## 🧭 Roteiro de avaliação (5 minutos)

1. **Central → Máquina do tempo → Reproduzir:** a cidade de 24 h atrás (ocorrências reais) até 24 h à frente (risco previsto), hora a hora.
2. **Central → Modo exercício → Acidente de trânsito → clique numa avenida:** o agente mais próximo é despachado automaticamente, os radares vizinhos perdem fluxo e, em 1 a 3 minutos, o F.O.G.O. **detecta a anomalia sozinho** (aba *Anomalias ao vivo*).
3. **Modo exercício → Furto de câmera:** o cadastro ainda diz "operacional", mas em segundos o F.O.G.O. percebe pelo *heartbeat* (3 batidas de 30 s perdidas) que a câmera parou de transmitir: o marcador pulsa em vermelho e o alerta aparece. No painel do equipamento, **Confirmar falha**.
4. **Modo exercício → Chuva forte:** começa a chover forte na cidade simulada. O risco é recalculado com o efeito de chuva **aprendido do histórico**, e os bairros de baixada (Cascata, Nova Marília, Alto Cafezal) disparam em risco de alagamento.
5. **Cidade preditiva → Próximas 24 horas:** clique em qualquer célula do mapa de calor e veja **por quê** (fatores multiplicativos e informações consideradas). Há um jogo do MAC no Bento de Abreu previsto.
6. **Cidade preditiva → Reforço de agentes:** aprove um deslocamento. A decisão vai para a auditoria (*Registro*).
7. **Cidade preditiva → Prova:** o modelo é treinado só com o passado, prevê cada um dos últimos 7 dias e é comparado com o que aconteceu.
8. **Inventário → Novo equipamento:** os campos mudam conforme o tipo, o GPS sai de um clique no mapa e o CEP preenche o bairro.

---

## ✅ O que foi pedido × onde está

### 1ª parte — Inventário Inteligente da Cidade
| Requisito | Onde |
|---|---|
| Tipos de equipamento (radar, câmera, balança, fiscalização autônoma, cancela, táxi, mototáxi, escolar, totem, patinete, moto de agente, viaturas GCM/PM…) | 16 tipos em `server/domain/catalog.js` · tela **Inventário** |
| Número de série, marca e modelo | formulário + validação de série única |
| Localização: CEP, bairro, cidade/UF, rua, referência ("nº 181", "oposto ao nº 181", "KM 203", "S/N"…) e GPS | formulário com **mapa clicável** (GPS) e **busca de CEP offline**; o bairro é deduzido do ponto |
| Situação (não instalado, operacional, mau funcionamento, em manutenção, desativado, furtado) | `SITUACOES` + histórico de cada mudança |
| Necessidade de manutenção (imediata, agendada, periódica) e data da próxima | campos validados (data obrigatória quando agendada/periódica) |
| Características particulares por tipo | **schema dinâmico por tipo**: o formulário é gerado e validado a partir dele |
| Cadastro de agentes (trânsito, GCM, PM) | tela **Agentes** (turno, status, bairro, veículo vinculado) |

### 2ª parte — Central de Operações da Cidade
| Requisito | Onde |
|---|---|
| Mapa com todos os equipamentos e agentes, ícone por tipo | **Central** (ícones próprios; na visão da cidade, pontos; ao aproximar, ícones) |
| Situação de cada equipamento de forma simples | anel colorido + pulso para falhas / sem sinal |
| Indicadores: total, operacionais, indisponíveis, % disponibilidade, agentes em atividade | faixa de indicadores no topo (ao vivo) |
| Filtros por tipo, situação, bairro, região, órgão | painel esquerdo da Central e Inventário |
| Destaque de manutenção imediata ou próxima | KPI + filtro "só manutenção urgente" + coluna no inventário |
| Alertas para situações críticas | painel de alertas (ocorrências graves, falhas, anomalias, risco previsto, eventos) |
| Detalhes pelo mapa | clique em equipamento, agente ou região |
| Visão consolidada por região | regiões de **Voronoi** coloridas por risco ou saúde + aba Regiões |
| Tempo real | Server-Sent Events: agentes, veículos, ocorrências e alertas atualizam sozinhos |

### 3ª parte — Cidade Preditiva
| Sugestão do enunciado | Onde |
|---|---|
| Regiões, dias e horários com maior probabilidade de ocorrências | mapa de calor **bairro × hora** (24 h) + pontos de atenção |
| Momentos que pedem reforço de agentes | **Reforço de agentes** (Hamilton + Húngaro, com aprovação humana) |
| Comportamentos fora do padrão | **Anomalias ao vivo** (sem sinal, fluxo de radar, pico de ocorrências) |
| Tendências de disponibilidade e utilização | **Tendências** (90 dias, por tipo, utilização, bairros mudando de padrão) |
| Índices de risco por bairro e período | índice 0–100 + "×N o normal para o horário" |
| Alertas preventivos e recomendações | alertas de risco previsto, eventos, manutenção preditiva |
| "Deixar claro o que é previsto, o que foi considerado e como ajuda" | painel de **explicação** em toda previsão + aba **Prova** |

---

## 🧠 O motor (100% autoral, sem API de IA)

```
λ(bairro, tipo, hora) = Base × Horário × DiaSemana × Chuva × Evento × Tendência × Cobertura
```

| Técnica | Para quê | Arquivo |
|---|---|---|
| Poisson log-linear multiplicativo | taxa esperada de cada tipo de ocorrência, explicável fator a fator | `server/engine/risco.js` |
| Bayes empírico (Gama–Poisson) | bairros com poucos dados não geram previsões exageradas | `risco.js` |
| Razões observado/esperado com encolhimento | efeito aprendido de chuva, eventos e tendência | `risco.js` |
| Backtest de 7 dias, *lift* e calibração | provar que a previsão funciona, sem olhar o futuro | `motor.js → backtest()` |
| Weibull por máxima verossimilhança com censura + Função Gama (Lanczos) | manutenção preditiva, MTBF e marcas que falham mais | `server/engine/manutencao.js` |
| Algoritmo Húngaro (Kuhn–Munkres, O(n³)) | menor deslocamento total dos agentes | `server/engine/algoritmos.js` |
| Método de Hamilton (maiores restos) | distribuição ideal de agentes proporcional à demanda | `algoritmos.js` |
| Diagrama de Voronoi (Sutherland–Hodgman) + envoltória convexa | regiões de influência dos bairros | `algoritmos.js` |
| z-score de Poisson contra o "pulso da cidade" | detectar via bloqueada/sensor com defeito | `server/sim/simulador.js → leituraFluxos()` |
| Cauda de Poisson | separar pico real de acaso | `algoritmos.js` |
| Haversine | distâncias e despacho do agente mais próximo | `server/lib/geo.js` |

### Integridade: o motor não "cola"
O simulador (`server/sim`) tem uma **verdade oculta**: perfis de bairro, efeito da chuva, uma marca de câmera ruim (Vigiax), um bairro com roubos em alta. O motor (`server/engine`) **nunca importa esses arquivos**, só lê o banco de dados. Tudo o que ele descobre, aprendeu com o histórico, como faria com dados reais.

---

## 🏗 Arquitetura

```
fogo/
├─ iniciar.bat / iniciar.sh     um clique para rodar
├─ server/                      Node.js puro, zero dependências
│  ├─ index.js                  servidor HTTP, arquivos estáticos, abre o navegador
│  ├─ api.js                    API REST + Server-Sent Events (/api/stream)
│  ├─ db.js                     SQLite em WebAssembly (sql.js, incluído em vendor/)
│  ├─ domain/                   catálogo (tipos, situações, schemas) e validação
│  ├─ engine/                   MOTOR: risco, manutenção, algoritmos, orquestração
│  ├─ sim/                      SIMULADOR: verdade oculta, geração da cidade, campo ao vivo
│  ├─ data/marilia.json         geografia real (OpenStreetMap), CEPs reais
│  └─ test/testes.js            testes automatizados (npm test)
├─ web/                         código-fonte da interface (React + TypeScript + Leaflet)
└─ public/                      interface já compilada (servida pelo Node)
```

- **Banco:** SQLite de verdade (schema, índices, transações), compilado para WebAssembly. Não precisa instalar nem compilar nada.
- **Segurança e robustez:** consultas sempre parametrizadas; validação de toda entrada contra schema (tipos fechados, CEP da faixa de Marília, coordenadas dentro da cidade, datas plausíveis); textos digitados escapados antes de ir para o mapa (sem XSS); URLs malformadas e corpos acima de 1 MB recusados com 400/413; proteção contra *path traversal*; escrita atômica do banco com recuperação de falha; erros inesperados registrados sem derrubar a central; trilha de auditoria de toda alteração e decisão.
- **Interface:** React 18 + TypeScript, mapa Leaflet, gráficos em SVG próprio (sem biblioteca de gráficos), fontes embarcadas (funciona offline).

Para alterar e recompilar a interface (opcional): `cd web && npm install && npm run build`.

---

## 🤖 Uso de IA (declaração exigida pelo regulamento)
O desenvolvimento teve apoio do **Claude (Anthropic)** como par de programação, em arquitetura, revisão e escrita de código. **O sistema em funcionamento não usa nenhuma IA externa**: todos os modelos preditivos são algoritmos estatísticos implementados no próprio projeto, explicáveis linha a linha (veja a tela *Como funciona*).

## ⚠ Sobre os dados
A geografia é real: bairros, CEPs, avenidas e pontos de referência de Marília vêm do OpenStreetMap. **Ocorrências, equipamentos, agentes e telemetria são simulados.** Os perfis de ocorrência atribuídos aos bairros são fictícios e não representam a realidade de nenhum deles. As marcas de equipamentos são fictícias.

---
Bhruno Santos · FATEC Garça · Coder Challenge 2026
